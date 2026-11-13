// Browser-only editable deck conversion shared by desktop and isolated render workers.
// Functions are self-contained for serialization into a throwaway Chromium page.

export type LayeredPptxBackgroundCapture = {
  dataUrl: string;
  height: number;
  left: number;
  slideIndex: number;
  top: number;
  width: number;
};

export function cjkPromotedFontFamily(fontFamily: string, text: string): string | null {
  // CJK symbols/punctuation, Hiragana, Katakana, CJK Unified Ideographs (+ Ext-A),
  // Yi, Hangul syllables, CJK compatibility ideographs, and half/fullwidth forms.
  const cjkText =
    /[\u2E80-\u2FDF\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/;
  // Family names that carry CJK glyph coverage: the Noto SC/TC/JP/KR webfonts the
  // html-ppt templates ship, plus common system CJK faces an authored deck may
  // name, so a promoted typeface resolves to a real CJK font across the office
  // suites instead of each app's arbitrary fallback.
  const cjkFamily =
    /noto\s*(sans|serif)\s*(sc|tc|hk|jp|kr|cjk)|source\s*han|pingfang|hiragino|heiti|songti|kaiti|fangsong|microsoft\s*(yahei|jhenghei)|yahei|simsun|simhei|mingliu|meiryo|ms\s*(gothic|mincho)|malgun|nanum|gulim|batang|dotum|思源|苹方|黑体|宋体|楷体|仿宋|微软雅黑|明體|明朝|ゴシック/i;
  if (!fontFamily || !cjkText.test(text || "")) return null;
  const families = fontFamily
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  if (families.length < 2) return null;
  const firstCjk = families.findIndex((f) => cjkFamily.test(f.replace(/^["']|["']$/g, "").trim()));
  // No CJK family to promote, or one already leads the stack.
  if (firstCjk <= 0) return null;
  return [families[firstCjk], ...families.filter((_, i) => i !== firstCjk)].join(", ");
}

// Serialized into the page: `prepare` applies every geometry-affecting export
// normalization before Chromium capture, while `export-prepared` consumes those
// measurements without moving the DOM again. Imported font faces are exposed in
// both phases so capture uses the authored fonts and export receives the same
// explicit font list. The default phase retains the single-call test/integration
// seam. Fonts are auto-detected + embedded; SVGs stay vector (editable in
// PowerPoint).
export async function runDomToPptx(
  slideSelector: string,
  layeredBackgrounds: Record<string, LayeredPptxBackgroundCapture> = {},
  phase: "export" | "prepare" | "export-prepared" = "export",
  importedStylesheetOverrides: Array<{ cssText: string; url: string }> = [],
): Promise<{ b64?: string; error?: string; prepared?: boolean }> {
  // dom-to-pptx fixes native ::before content at -1,000,000. Reserve the two
  // preceding slots for its raster background and the slide background below
  // it so a slide-root pseudo remains visible over an opaque slide fill.
  const slideBackgroundSortSlot = "-1000002";
  const pseudoBeforeBackgroundSortSlot = "-1000001";
  const pseudoAfterBackgroundSortSlot = "0";
  function importedStylesheetUrls(cssText: string, baseHref: string): string[] {
    const urls: string[] = [];
    const importPattern =
      /@import\s+(?:url\(\s*)?(?:(["'])([\s\S]*?)\1|([^"')\s;]+))\s*\)?[^;]*;/giu;
    for (const match of cssText.matchAll(importPattern)) {
      const raw = match[2] || match[3];
      if (!raw) continue;
      try {
        urls.push(new URL(raw, baseHref).href);
      } catch {
        // Ignore malformed author CSS and let the existing font fallback apply.
      }
    }
    return urls;
  }

  function importedFontFaceCss(cssText: string, baseHref: string): string {
    const faces = (cssText.match(/@font-face\s*\{[\s\S]*?\}/giu) || []).map((rule) => {
      const value = (property: string): string =>
        rule.match(new RegExp(`${property}\\s*:\\s*([^;]+)`, "iu"))?.[1]?.trim() || "";
      return {
        family: value("font-family").replace(/^['"]|['"]$/g, ""),
        rule,
        style: value("font-style").toLowerCase() || "normal",
        unicodeRange: value("unicode-range"),
        weight: value("font-weight").toLowerCase() || "400",
      };
    });
    const preferredFace = new Map<string, { rank: number; style: string; weight: string }>();
    for (const face of faces) {
      const rank = face.style === "normal" ? (face.weight === "400" || face.weight === "normal" ? 0 : 1) : 2;
      const current = preferredFace.get(face.family);
      if (!current || rank < current.rank) {
        preferredFace.set(face.family, { rank, style: face.style, weight: face.weight });
      }
    }

    const preferredRule = new Map<string, { rank: number; rule: string }>();
    for (const face of faces) {
      const preferred = preferredFace.get(face.family);
      if (preferred?.style !== face.style || preferred.weight !== face.weight) continue;
      // Google Fonts commonly returns one @font-face per unicode subset. The
      // vendored converter can fail while merging some families' subsets, so
      // prefer the complete face when present, then its Latin core subset.
      const rank = face.unicodeRange === "" ? 0 : /U\+0000-00FF/iu.test(face.unicodeRange) ? 1 : 2;
      const current = preferredRule.get(face.family);
      if (!current || rank < current.rank) preferredRule.set(face.family, { rank, rule: face.rule });
    }

    return faces
      .filter((face) => preferredRule.get(face.family)?.rule === face.rule)
      .map((rule) =>
        rule.rule.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/giu, (_match, _quote, raw: string) => {
          try {
            return `url("${new URL(raw.trim(), baseHref).href}")`;
          } catch {
            return `url("${raw.trim()}")`;
          }
        }),
      )
      .join("\n");
  }

  // dom-to-pptx's autoEmbedFonts scanner sees top-level CSSFontFaceRule entries,
  // but many OpenDesign decks load Google Fonts through an inline `@import`.
  // Expand those imports into a throwaway top-level style so the vendored engine
  // can discover and embed the actual font files instead of only writing their
  // family names into the PPTX. The render window is destroyed after export, so
  // this never mutates the authored HTML or the live preview.
  async function exposeImportedFontFaces(): Promise<Array<{ name: string; urls: string[] }>> {
    const importedUrls = new Set<string>();
    document.querySelectorAll("style").forEach((style) => {
      for (const url of importedStylesheetUrls(style.textContent || "", document.baseURI)) {
        importedUrls.add(url);
      }
    });
    if (importedUrls.size === 0) return [];

    const visited = new Set<string>();
    const fontFaceRules: string[] = [];
    const collect = async (url: string): Promise<void> => {
      if (visited.has(url)) return;
      visited.add(url);
      try {
        const override = importedStylesheetOverrides.find((entry) => entry.url === url);
        const response = override ? null : await fetch(url);
        if (response && !response.ok) throw new Error(`HTTP ${response.status}`);
        const cssText = override?.cssText ?? (await response!.text());
        for (const nested of importedStylesheetUrls(cssText, url)) await collect(nested);
        const fontCss = importedFontFaceCss(cssText, url);
        if (fontCss) fontFaceRules.push(fontCss);
      } catch (error) {
        console.warn("Cannot expose imported fonts for editable PPTX:", url, error);
      }
    };
    for (const url of importedUrls) await collect(url);
    if (fontFaceRules.length === 0) return [];

    const combinedCss = fontFaceRules.join("\n");
    const style = document.createElement("style");
    style.setAttribute("data-od-pptx-imported-font-faces", "true");
    style.textContent = combinedCss;
    document.head.appendChild(style);

    const fontsByFamily = new Map<string, Set<string>>();
    for (const rule of combinedCss.match(/@font-face\s*\{[\s\S]*?\}/giu) || []) {
      const family = rule
        .match(/font-family\s*:\s*([^;]+)/iu)?.[1]
        ?.trim()
        .replace(/^['"]|['"]$/g, "");
      if (!family) continue;
      const urls = fontsByFamily.get(family) || new Set<string>();
      for (const match of rule.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/giu)) {
        if (match[1]) urls.add(match[1]);
      }
      if (urls.size > 0) fontsByFamily.set(family, urls);
    }
    return Array.from(fontsByFamily, ([name, urls]) => ({ name, urls: Array.from(urls) }));
  }

  function isTransparentColor(input: string): boolean {
    const value = input.trim().toLowerCase();
    return value === "" || value === "transparent" || value === "rgba(0, 0, 0, 0)";
  }

  function firstCssColor(input: string): string | null {
    const rgb = input.match(/rgba?\([^)]*\)/i);
    if (rgb) return rgb[0];
    const hex = input.match(/#[0-9a-f]{3,8}\b/i);
    return hex ? hex[0] : null;
  }

  function effectiveBackgroundStyle(slide: HTMLElement): {
    color: string;
    image: string;
    position: string;
    size: string;
    repeat: string;
    origin: string;
    clip: string;
  } | null {
    const candidates: Element[] = [];
    for (let el: Element | null = slide; el; el = el.parentElement) candidates.push(el);
    if (document.body && !candidates.includes(document.body)) candidates.push(document.body);
    if (document.documentElement && !candidates.includes(document.documentElement)) {
      candidates.push(document.documentElement);
    }

    for (const el of candidates) {
      const style = getComputedStyle(el);
      const bgColor = style.backgroundColor;
      const bgImage = style.backgroundImage;
      const hasImage = bgImage && bgImage !== "none";
      const hasColor = bgColor && !isTransparentColor(bgColor);
      const fallbackColor = hasColor ? bgColor : firstCssColor(bgImage);
      if (!hasImage && !hasColor) continue;
      if (!fallbackColor) continue;
      return {
        color: fallbackColor,
        image: bgImage,
        position: style.backgroundPosition,
        size: style.backgroundSize,
        repeat: style.backgroundRepeat,
        origin: style.backgroundOrigin,
        clip: style.backgroundClip,
      };
    }
    return null;
  }

  function ensureExplicitSlideBackgrounds(slides: HTMLElement[]): void {
    for (const slide of slides) {
      slide.querySelectorAll(":scope > [data-od-pptx-bg]").forEach((el) => el.remove());
      // preserveLayeredGradientBackgrounds owns supported layered backgrounds
      // authored directly on a slide. Adding the usual fallback shim as well
      // would export the same semi-transparent texture twice.
      if (hasRasterizableLayeredGradientBackground(getComputedStyle(slide).backgroundImage || "")) {
        continue;
      }
      const background = effectiveBackgroundStyle(slide);
      if (!background) continue;

      const bg = document.createElement("div");
      bg.setAttribute("data-od-pptx-bg", "true");
      bg.setAttribute("aria-hidden", "true");
      bg.style.setProperty("position", "absolute", "important");
      bg.style.setProperty("inset", "0", "important");
      bg.style.setProperty("z-index", slideBackgroundSortSlot, "important");
      bg.style.setProperty("pointer-events", "none", "important");
      bg.style.setProperty("background-color", background.color, "important");
      bg.style.setProperty("background-image", background.image, "important");
      bg.style.setProperty("background-position", background.position, "important");
      bg.style.setProperty("background-size", background.size, "important");
      bg.style.setProperty("background-repeat", background.repeat, "important");
      bg.style.setProperty("background-origin", background.origin, "important");
      bg.style.setProperty("background-clip", background.clip, "important");

      const style = getComputedStyle(slide);
      if (style.position === "static") slide.style.setProperty("position", "relative", "important");
      if (style.overflow === "visible") slide.style.setProperty("overflow", "hidden", "important");
      slide.style.setProperty("background-color", background.color, "important");
      Array.from(slide.children).forEach((child) => {
        if (child.getAttribute("data-od-pptx-bg") === "true") return;
        const childStyle = getComputedStyle(child as Element);
        const element = child as HTMLElement;
        if (childStyle.position === "static") {
          element.style.setProperty("position", "relative", "important");
        }
        if (childStyle.zIndex === "auto") {
          element.style.setProperty("z-index", "1", "important");
        }
      });
      slide.prepend(bg);
    }
  }

  function splitCssBackgroundLayers(input: string): string[] {
    const layers: string[] = [];
    let current = "";
    let depth = 0;
    let quote = "";
    let escaped = false;
    for (const char of input) {
      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }
      if (char === "\\") {
        current += char;
        escaped = true;
        continue;
      }
      if (quote) {
        current += char;
        if (char === quote) quote = "";
        continue;
      }
      if (char === '"' || char === "'") {
        current += char;
        quote = char;
        continue;
      }
      if (char === "(") depth += 1;
      else if (char === ")") depth = Math.max(0, depth - 1);
      if (char === "," && depth === 0) {
        if (current.trim()) layers.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    if (current.trim()) layers.push(current.trim());
    return layers;
  }

  function hasRasterizableLayeredGradientBackground(input: string): boolean {
    const layers = splitCssBackgroundLayers(input);
    if (layers.length < 2) return false;
    // Keep this allowlist aligned with html2canvas 1.4.1's
    // SUPPORTED_IMAGE_FUNCTIONS. In particular, repeating and conic gradients
    // are discarded by its clone parser and must remain on the authored node.
    const supportedGradient =
      /^(?:(?:-(?:moz|ms|o|webkit)-)?(?:linear|radial)-gradient|-webkit-gradient)\(/i;
    return layers.every((layer) => supportedGradient.test(layer));
  }

  function hasTextBackgroundClip(input: string): boolean {
    return splitCssBackgroundLayers(input).some((layer) => layer.toLowerCase() === "text");
  }

  function hasNonNormalBlendMode(input: string): boolean {
    const mode = (input || "normal").trim().toLowerCase();
    return mode !== "" && mode !== "normal";
  }

  function hasBackdropFilter(style: CSSStyleDeclaration): boolean {
    const value = (
      style.backdropFilter ||
      style.getPropertyValue?.("backdrop-filter") ||
      style.getPropertyValue?.("-webkit-backdrop-filter") ||
      "none"
    ).trim().toLowerCase();
    return value !== "" && value !== "none";
  }

  function hasCssMask(style: CSSStyleDeclaration): boolean {
    const maskImages = [
      style.maskImage || style.getPropertyValue("mask-image"),
      style.webkitMaskImage || style.getPropertyValue("-webkit-mask-image"),
    ];
    return maskImages.some((image) => image && image.trim().toLowerCase() !== "none");
  }

  function setCaptureBoxStyles(background: HTMLElement, style: CSSStyleDeclaration): void {
    background.style.setProperty("box-sizing", "border-box", "important");
    background.style.setProperty(
      "padding",
      `${style.paddingTop || "0px"} ${style.paddingRight || "0px"} ${style.paddingBottom || "0px"} ${style.paddingLeft || "0px"}`,
      "important",
    );
    background.style.setProperty(
      "border-width",
      `${style.borderTopWidth || "0px"} ${style.borderRightWidth || "0px"} ${style.borderBottomWidth || "0px"} ${style.borderLeftWidth || "0px"}`,
      "important",
    );
    background.style.setProperty("border-style", "solid", "important");
    background.style.setProperty("border-color", "transparent", "important");
    background.style.setProperty("border-radius", style.borderRadius || "0px", "important");
    background.style.setProperty("box-shadow", style.boxShadow || "none", "important");
    background.style.setProperty("background-color", style.backgroundColor, "important");
    background.style.setProperty("background-image", style.backgroundImage, "important");
    background.style.setProperty("background-position", style.backgroundPosition, "important");
    background.style.setProperty("background-size", style.backgroundSize, "important");
    background.style.setProperty("background-repeat", style.backgroundRepeat, "important");
    background.style.setProperty("background-origin", style.backgroundOrigin, "important");
    background.style.setProperty("background-clip", style.backgroundClip, "important");
    background.style.setProperty("background-blend-mode", style.backgroundBlendMode || "normal", "important");
    background.style.setProperty("clip-path", style.clipPath || "none", "important");
    background.style.setProperty("filter", style.filter || "none", "important");
    const backdropFilter =
      style.backdropFilter ||
      style.getPropertyValue?.("backdrop-filter") ||
      style.getPropertyValue?.("-webkit-backdrop-filter") ||
      "none";
    background.style.setProperty("backdrop-filter", backdropFilter, "important");
    background.style.setProperty("-webkit-backdrop-filter", backdropFilter, "important");
    background.style.setProperty("opacity", style.opacity || "1", "important");
    background.style.setProperty("mix-blend-mode", style.mixBlendMode || "normal", "important");
    background.style.setProperty("transform", style.transform || "none", "important");
    background.style.setProperty("transform-origin", style.transformOrigin || "50% 50%", "important");
    background.style.setProperty("transform-box", style.transformBox || "view-box", "important");
    background.style.setProperty("translate", style.translate || "none", "important");
    background.style.setProperty("rotate", style.rotate || "none", "important");
    background.style.setProperty("scale", style.scale || "none", "important");
  }

  function preserveLayeredPseudoGradientBackgrounds(elements: Set<HTMLElement>): void {
    let nativePseudoBackgroundStyle: HTMLStyleElement | null = null;
    const neutralizeNativePseudoBackground = (
      element: HTMLElement,
      pseudo: "::before" | "::after",
    ): void => {
      element.setAttribute(
        pseudo === "::before"
          ? "data-od-pptx-rasterized-before-background"
          : "data-od-pptx-rasterized-after-background",
        "true",
      );
      if (nativePseudoBackgroundStyle) return;
      nativePseudoBackgroundStyle = document.createElement("style");
      nativePseudoBackgroundStyle.textContent = `
        [data-od-pptx-rasterized-before-background="true"]::before,
        [data-od-pptx-rasterized-after-background="true"]::after{
          background-color:transparent!important;
        }
      `;
      document.head.append(nativePseudoBackgroundStyle);
    };
    for (const element of elements) {
      for (const pseudo of ["::before", "::after"] as const) {
        const style = getComputedStyle(element, pseudo);
        const content = (style.content || "").trim().toLowerCase();
        const isGenerated = content !== "" && content !== "none" && content !== "normal" && style.display !== "none";
        const hasMaterializedCapture = Array.from(element.children).some(
          (child) => child.getAttribute("data-od-pptx-materialized-pseudo") === pseudo,
        );
        if (hasMaterializedCapture) {
          // The Chromium helper already owns the computed fallback color. Keep
          // native pseudo text and borders, but prevent dom-to-pptx from
          // emitting that same color as an opaque fill above the captured PNG.
          neutralizeNativePseudoBackground(element, pseudo);
          continue;
        }
        if (
          !isGenerated ||
          (style.position !== "absolute" && style.position !== "fixed") ||
          !hasRasterizableLayeredGradientBackground(style.backgroundImage || "") ||
          // The html2canvas custom-element path has no blend-mode parser and
          // cannot reproduce this background without its authored backdrop.
          hasNonNormalBlendMode(style.mixBlendMode || "") ||
          hasBackdropFilter(style) ||
          hasTextBackgroundClip(style.backgroundClip || "") ||
          hasTextBackgroundClip(style.webkitBackgroundClip || "") ||
          hasCssMask(style)
        ) {
          continue;
        }

        // dom-to-pptx only reads pseudo-element content, color, and border. A
        // background-only custom element enters its existing html2canvas path,
        // preserving the layered image while the native pseudo handling keeps
        // any authored text or border editable.
        const background = document.createElement("od-pptx-layered-background");
        background.setAttribute("data-od-pptx-layered-bg", "true");
        background.setAttribute("data-od-pptx-pseudo", pseudo);
        background.setAttribute("aria-hidden", "true");
        background.style.setProperty("position", style.position, "important");
        background.style.setProperty("top", style.top || "auto", "important");
        background.style.setProperty("right", style.right || "auto", "important");
        background.style.setProperty("bottom", style.bottom || "auto", "important");
        background.style.setProperty("left", style.left || "auto", "important");
        background.style.setProperty("width", style.width || "auto", "important");
        background.style.setProperty("height", style.height || "auto", "important");
        // Keep the raster background immediately below the converter's fixed
        // native pseudo text/border slots. Native ::after always sorts at the
        // host's z=0 Infinity slot, regardless of its authored z-index.
        background.style.setProperty(
          "z-index",
          pseudo === "::before" ? pseudoBeforeBackgroundSortSlot : pseudoAfterBackgroundSortSlot,
          "important",
        );
        background.style.setProperty("pointer-events", "none", "important");
        setCaptureBoxStyles(background, style);

        // The converter keeps pseudo content and borders editable, but it also
        // emits a native solid fill from background-color while ignoring the
        // layered background-image. The raster helper already owns both, so
        // neutralize only that native fallback after copying its computed color.
        neutralizeNativePseudoBackground(element, pseudo);

        if (pseudo === "::before") element.prepend(background);
        else element.append(background);
      }
    }
  }

  function suppressCapturedSlidePaint(slide: HTMLElement, capture: HTMLElement): void {
    // dom-to-pptx needs the slide itself to remain measurable as the export
    // root. Keep only the replacement image visible inside it and neutralize
    // effects that Chromium already baked into that whole-paint capture.
    slide.querySelectorAll<HTMLElement>("*").forEach((descendant) => {
      if (descendant !== capture && !capture.contains(descendant)) {
        descendant.style.setProperty("display", "none", "important");
      }
    });
    slide.style.setProperty("background", "transparent", "important");
    slide.style.setProperty("border", "0", "important");
    slide.style.setProperty("box-shadow", "none", "important");
    slide.style.setProperty("clip-path", "none", "important");
    slide.style.setProperty("color", "transparent", "important");
    slide.style.setProperty("filter", "none", "important");
    slide.style.setProperty("backdrop-filter", "none", "important");
    slide.style.setProperty("-webkit-backdrop-filter", "none", "important");
    slide.style.setProperty("mask-image", "none", "important");
    slide.style.setProperty("-webkit-mask-image", "none", "important");
    slide.style.setProperty("mix-blend-mode", "normal", "important");
    slide.style.setProperty("opacity", "1", "important");
    slide.style.setProperty("outline", "none", "important");
    slide.style.setProperty("text-shadow", "none", "important");
    slide.style.setProperty("-webkit-text-fill-color", "transparent", "important");
    slide.style.setProperty("transform", "none", "important");
    slide.style.setProperty("translate", "none", "important");
    slide.style.setProperty("rotate", "none", "important");
    slide.style.setProperty("scale", "none", "important");
  }

  function preserveLayeredGradientBackgrounds(slides: HTMLElement[]): void {
    if (document.querySelectorAll("[data-od-pptx-suppress-before], [data-od-pptx-suppress-after]").length > 0) {
      const suppressedPseudoStyle = document.createElement("style");
      suppressedPseudoStyle.textContent = `
        [data-od-pptx-suppress-before="true"]::before,
        [data-od-pptx-suppress-after="true"]::after{
          content:none!important;
          display:none!important;
          border:0!important;
          background:none!important;
        }
      `;
      document.head.append(suppressedPseudoStyle);
    }
    const slideElements = new Set(slides);
    const elements = new Set<HTMLElement>();
    for (const slide of slides) {
      elements.add(slide);
      slide.querySelectorAll<HTMLElement>("*").forEach((el) => elements.add(el));
    }

    const capturedCompositingMembers = new Set<HTMLElement>();
    const capturedEntirePaintRoots = new Set<HTMLElement>();
    for (const element of elements) {
      if (element.getAttribute("data-od-pptx-compositing-context") !== "true") continue;
      const captureId = element.getAttribute("data-od-pptx-layer-capture-id") || "";
      const captured = layeredBackgrounds[captureId];
      if (!captured) continue;
      const slide = slides[captured.slideIndex];
      if (!slide) continue;

      const style = getComputedStyle(element);
      // Export the flattened context beside its source. Ordinary members lose
      // only the backgrounds already present in the PNG; members whose own
      // compositor effect required whole-paint capture are suppressed entirely.
      const image = document.createElement("img");
      image.setAttribute("data-od-pptx-layered-bg", "true");
      image.setAttribute("aria-hidden", "true");
      image.src = captured.dataUrl;
      image.style.setProperty("position", "absolute", "important");
      image.style.setProperty("left", `${captured.left}px`, "important");
      image.style.setProperty("top", `${captured.top}px`, "important");
      image.style.setProperty("width", `${captured.width}px`, "important");
      image.style.setProperty("height", `${captured.height}px`, "important");
      image.style.setProperty("display", "block", "important");
      image.style.setProperty("object-fit", "fill", "important");
      image.style.setProperty("pointer-events", "none", "important");
      image.style.setProperty("z-index", style.zIndex || "auto", "important");
      image.getBoundingClientRect = () => {
        const slideRect = slide.getBoundingClientRect();
        const left = slideRect.left + captured.left;
        const top = slideRect.top + captured.top;
        return {
          bottom: top + captured.height,
          height: captured.height,
          left,
          right: left + captured.width,
          top,
          width: captured.width,
          x: left,
          y: top,
          toJSON: () => ({}),
        } as DOMRect;
      };
      if (element === slide) slide.prepend(image);
      else element.parentElement?.insertBefore(image, element);
      document
        .querySelectorAll<HTMLElement>(`[data-od-pptx-compositing-member="${captureId}"]`)
        .forEach((member) => {
          if (
            member.hasAttribute("data-od-pptx-materialized-pseudo") ||
            member.hasAttribute("data-od-pptx-capture-entire-element")
          ) {
            if (member === slide) suppressCapturedSlidePaint(member, image);
            else member.style.setProperty("display", "none", "important");
            capturedEntirePaintRoots.add(member);
          } else {
            member.style.setProperty("background-image", "none", "important");
            member.style.setProperty("background-color", "transparent", "important");
          }
          capturedCompositingMembers.add(member);
        });
    }

    for (const element of elements) {
      if (capturedCompositingMembers.has(element)) continue;
      if (Array.from(capturedEntirePaintRoots).some((root) => root.contains(element))) continue;
      const style = getComputedStyle(element);
      const captureId = element.getAttribute("data-od-pptx-layer-capture-id") || "";
      const captured = layeredBackgrounds[captureId];
      if (
        !hasRasterizableLayeredGradientBackground(style.backgroundImage || "") ||
        (!captured && (
          hasTextBackgroundClip(style.backgroundClip || "") ||
          hasTextBackgroundClip(style.webkitBackgroundClip || "")
        )) ||
        // The custom-element fallback uses html2canvas, which cannot preserve
        // masks. Production exports provide a Chromium capture for these.
        (hasCssMask(style) && !captured)
      ) {
        continue;
      }
      const isStaticNestedElement = style.position === "static" && !slideElements.has(element);

      if (captured) {
        const slide = slides[captured.slideIndex];
        if (!slide) continue;
        const materializedPseudo = element.getAttribute("data-od-pptx-materialized-pseudo");
        const capturesEntireElement = element.getAttribute("data-od-pptx-capture-entire-element") === "true";
        const background = document.createElement("img");
        background.setAttribute("data-od-pptx-layered-bg", "true");
        if (materializedPseudo) background.setAttribute("data-od-pptx-pseudo", materializedPseudo);
        background.setAttribute("aria-hidden", "true");
        background.src = captured.dataUrl;
        background.style.setProperty("position", "absolute", "important");
        background.style.setProperty("left", `${captured.left}px`, "important");
        background.style.setProperty("top", `${captured.top}px`, "important");
        background.style.setProperty("width", `${captured.width}px`, "important");
        background.style.setProperty("height", `${captured.height}px`, "important");
        background.style.setProperty("display", "block", "important");
        background.style.setProperty("object-fit", "fill", "important");
        background.style.setProperty("pointer-events", "none", "important");
        background.style.setProperty(
          "z-index",
          element === slide
            ? slideBackgroundSortSlot
            : materializedPseudo === "::before"
              ? pseudoBeforeBackgroundSortSlot
              : materializedPseudo === "::after"
                ? pseudoAfterBackgroundSortSlot
                : style.zIndex || "auto",
          "important",
        );
        background.getBoundingClientRect = () => {
          const slideRect = slide.getBoundingClientRect();
          const left = slideRect.left + captured.left;
          const top = slideRect.top + captured.top;
          return {
            bottom: top + captured.height,
            height: captured.height,
            left,
            right: left + captured.width,
            top,
            width: captured.width,
            x: left,
            y: top,
            toJSON: () => ({}),
          } as DOMRect;
        };
        element.style.setProperty("background-image", "none", "important");
        element.style.setProperty("background-color", "transparent", "important");
        if (element === slide) slide.prepend(background);
        else element.parentElement?.insertBefore(background, element);
        if (materializedPseudo || capturesEntireElement) {
          // The helper exists only to give Chromium a real capture target. Its
          // raster image now owns that paint; leaving the custom element in the
          // converter walk would emit the same pseudo as a second media layer.
          if (element === slide) suppressCapturedSlidePaint(element, background);
          else element.style.setProperty("display", "none", "important");
          capturedEntirePaintRoots.add(element);
        }
        continue;
      }

      // dom-to-pptx's native gradient parser assumes one linear-gradient and
      // greedily merges layered gradients into one invalid SVG. In test-only
      // callers without the main-process capture seam, retain the existing
      // custom-element fallback for unmasked layers.
      const background = document.createElement("od-pptx-layered-background");
      background.setAttribute("data-od-pptx-layered-bg", "true");
      background.setAttribute("aria-hidden", "true");
      background.style.setProperty("position", "absolute", "important");
      background.style.setProperty("inset", "0", "important");
      background.style.setProperty(
        "z-index",
        slideElements.has(element) ? slideBackgroundSortSlot : "0",
        "important",
      );
      background.style.setProperty("pointer-events", "none", "important");
      setCaptureBoxStyles(background, style);

      if (isStaticNestedElement) {
        // A static panel and its absolutely positioned descendants share the
        // same outer containing block. Anchor only the capture child to the
        // panel's measured border box so the authored panel never becomes a
        // new containing block.
        background.style.setProperty("inset", "auto", "important");
        background.style.setProperty("left", `${element.offsetLeft}px`, "important");
        background.style.setProperty("top", `${element.offsetTop}px`, "important");
        background.style.setProperty("width", `${element.offsetWidth}px`, "important");
        background.style.setProperty("height", `${element.offsetHeight}px`, "important");
      } else {
        // ensureExplicitSlideBackgrounds already establishes this containing-
        // block contract for slides; positioned authored elements already own
        // the absolutely positioned capture child.
        if (style.position === "static") element.style.setProperty("position", "relative", "important");
      }

      element.style.setProperty("background-image", "none", "important");
      element.style.setProperty("background-color", "transparent", "important");
      element.prepend(background);
    }

    preserveLayeredPseudoGradientBackgrounds(elements);
  }

  function stabilizeLargeSingleLineText(slides: HTMLElement[]): void {
    for (const slide of slides) {
      slide.querySelectorAll<HTMLElement>("*").forEach((el) => {
        const rawText = el.innerText || el.textContent || "";
        const text = rawText.replace(/\s+/g, " ").trim();
        if (!text || rawText.includes("\n")) return;

        const style = getComputedStyle(el);
        const fontSizePx = Number.parseFloat(style.fontSize);
        if (!Number.isFinite(fontSizePx) || fontSizePx < 96) return;

        const lineHeightPx = Number.parseFloat(style.lineHeight);
        if (!Number.isFinite(lineHeightPx) || lineHeightPx <= 0 || lineHeightPx > fontSizePx * 1.05) return;

        const rect = el.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) return;

        const justify =
          style.textAlign === "center" || style.textAlign === "-webkit-center"
            ? "center"
            : style.textAlign === "right" || style.textAlign === "end"
              ? "flex-end"
              : "flex-start";

        el.style.setProperty("display", "flex", "important");
        el.style.setProperty("align-items", "center", "important");
        el.style.setProperty("justify-content", justify, "important");
        el.style.setProperty("width", `${rect.width}px`, "important");
        el.style.setProperty("height", `${rect.height}px`, "important");
        el.style.setProperty("line-height", "normal", "important");
        el.style.setProperty("white-space", "nowrap", "important");
        el.style.setProperty("overflow", "visible", "important");
      });
    }
  }

  // An authored `<br>` is a deliberate line boundary. Prevent PowerPoint/WPS
  // from applying a second soft wrap inside either line when its font metrics
  // differ slightly from Chromium's. dom-to-pptx maps `white-space: nowrap` to
  // `wrap: false` while retaining explicit breakLine runs.
  function stabilizeAuthoredHeadingLines(slides: HTMLElement[]): void {
    for (const slide of slides) {
      slide.querySelectorAll<HTMLElement>("h1, h2, h3").forEach((heading) => {
        if (heading.querySelector("br")) {
          heading.style.setProperty("white-space", "nowrap", "important");
        }
      });
    }
  }

  // Reorder each text run's font-family so CJK runs name their CJK typeface (not
  // the Latin webfont that leads our template stacks) before dom-to-pptx reads it,
  // so PowerPoint/WPS/Keynote all resolve the same real font. See
  // cjkPromotedFontFamily for the why. Keyed on the element that directly owns the
  // text so a container that only holds Latin markup is never rewritten. Decide on
  // the element's COMBINED direct text: bilingual markup often splits one element
  // across text nodes (`Product Launch<br>产品发布`, `Welcome <strong>…</strong> 欢迎`),
  // so a later CJK chunk must still win even when a Latin chunk comes first.
  function promoteCjkTypefaces(slides: HTMLElement[]): void {
    const touched = new Set<HTMLElement>();
    for (const slide of slides) {
      const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node.parentElement;
        if (!el || touched.has(el)) continue;
        touched.add(el);
        let combined = "";
        for (const child of el.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) combined += child.nodeValue || "";
        }
        if (!combined.trim()) continue;
        const promoted = cjkPromotedFontFamily(getComputedStyle(el).fontFamily, combined);
        if (promoted) el.style.setProperty("font-family", promoted, "important");
      }
    }
  }

  try {
    const w = window as unknown as {
      domToPptx?: { exportToPptx: (target: unknown, options: unknown) => Promise<Blob> };
    };
    if (!w.domToPptx || typeof w.domToPptx.exportToPptx !== "function") {
      return { error: "dom-to-pptx engine did not load" };
    }
    const slides = Array.prototype.slice
      .call(document.querySelectorAll(slideSelector))
      .filter((el) => !(el as HTMLElement).closest(".mini-slide, .overview, .notes-overlay, .thumb"));
    if (slides.length === 0) return { error: "no slides to export" };
    const importedFonts = await exposeImportedFontFaces();
    await document.fonts?.ready;
    if (phase !== "export-prepared") {
      ensureExplicitSlideBackgrounds(slides as HTMLElement[]);
      stabilizeLargeSingleLineText(slides as HTMLElement[]);
      stabilizeAuthoredHeadingLines(slides as HTMLElement[]);
      promoteCjkTypefaces(slides as HTMLElement[]);
      // dom-to-pptx assumes `node.className` is a string, but SVG elements expose
      // an SVGAnimatedString, so its DOM walk throws on decks containing inline SVG.
      // Normalize those to a plain string in this throwaway render window.
      document.querySelectorAll("*").forEach((el) => {
        const cn = (el as { className?: unknown }).className;
        if (cn != null && typeof cn !== "string") {
          try {
            Object.defineProperty(el, "className", {
              value: (cn as { baseVal?: string }).baseVal ?? "",
              configurable: true,
              writable: true,
            });
          } catch {
            // Leave it; dom-to-pptx may still handle this node.
          }
        }
      });
    }
    if (phase === "prepare") return { prepared: true };
    preserveLayeredGradientBackgrounds(slides as HTMLElement[]);
    const blob = await w.domToPptx.exportToPptx(slides, {
      fileName: "deck.pptx",
      skipDownload: true,
      autoEmbedFonts: true,
      ...(importedFonts.length > 0 ? { fonts: importedFonts } : {}),
      svgAsVector: true,
    });
    if (!blob || typeof (blob as Blob).arrayBuffer !== "function") {
      return { error: "dom-to-pptx returned no blob" };
    }
    const bytes = new Uint8Array(await (blob as Blob).arrayBuffer());
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
    }
    return { b64: btoa(binary) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}


export type LayeredPptxBackgroundTarget = { id: string };
export type LayeredPptxBackgroundGeometry = Omit<LayeredPptxBackgroundCapture, "dataUrl"> & {
  pageX: number;
  pageY: number;
};

export function collectLayeredPptxBackgroundTargets(slideSelector: string): LayeredPptxBackgroundTarget[] {
  function splitLayers(input: string): string[] {
    const layers: string[] = [];
    let current = "";
    let depth = 0;
    let quote = "";
    let escaped = false;
    for (const char of input) {
      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }
      if (char === "\\") {
        current += char;
        escaped = true;
        continue;
      }
      if (quote) {
        current += char;
        if (char === quote) quote = "";
        continue;
      }
      if (char === '"' || char === "'") {
        current += char;
        quote = char;
        continue;
      }
      if (char === "(") depth += 1;
      else if (char === ")") depth = Math.max(0, depth - 1);
      if (char === "," && depth === 0) {
        if (current.trim()) layers.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    if (current.trim()) layers.push(current.trim());
    return layers;
  }

  function isSupportedLayeredGradient(input: string): boolean {
    const layers = splitLayers(input);
    if (layers.length < 2) return false;
    const supportedGradient =
      /^(?:(?:-(?:moz|ms|o|webkit)-)?(?:linear|radial)-gradient|-webkit-gradient)\(/i;
    return layers.every((layer) => supportedGradient.test(layer));
  }

  function hasTextClip(style: CSSStyleDeclaration): boolean {
    return [style.backgroundClip, style.webkitBackgroundClip]
      .flatMap((value) => splitLayers(value || ""))
      .some((value) => value.toLowerCase() === "text");
  }

  function hasNonNormalBlendMode(style: CSSStyleDeclaration): boolean {
    const mode = (style.mixBlendMode || "normal").trim().toLowerCase();
    return mode !== "" && mode !== "normal";
  }

  function hasBackdropFilter(style: CSSStyleDeclaration): boolean {
    const value = (
      style.backdropFilter ||
      style.getPropertyValue?.("backdrop-filter") ||
      style.getPropertyValue?.("-webkit-backdrop-filter") ||
      "none"
    ).trim().toLowerCase();
    return value !== "" && value !== "none";
  }

  function dependsOnBackdrop(style: CSSStyleDeclaration): boolean {
    return hasNonNormalBlendMode(style) || hasBackdropFilter(style);
  }

  function hasNonNormalBackgroundBlendMode(style: CSSStyleDeclaration): boolean {
    return (style.backgroundBlendMode || "normal")
      .split(",")
      .some((mode) => mode.trim().toLowerCase() !== "normal");
  }

  function hasCssMask(style: CSSStyleDeclaration): boolean {
    const images = [
      style.maskImage || style.getPropertyValue("mask-image"),
      style.webkitMaskImage || style.getPropertyValue("-webkit-mask-image"),
    ];
    return images.some((image) => image && image.trim().toLowerCase() !== "none");
  }

  function hasCssClipPath(style: CSSStyleDeclaration): boolean {
    const value = (
      style.clipPath ||
      style.getPropertyValue?.("clip-path") ||
      style.getPropertyValue?.("-webkit-clip-path") ||
      "none"
    ).trim().toLowerCase();
    return value !== "" && value !== "none";
  }

  function copyComputedMaskStyles(background: HTMLElement, style: CSSStyleDeclaration): void {
    for (let index = 0; index < style.length; index += 1) {
      const property = style.item(index);
      if (!property.startsWith("mask-") && !property.startsWith("-webkit-mask-")) continue;
      const value = style.getPropertyValue(property);
      if (value) background.style.setProperty(property, value, "important");
    }
  }

  function hasUnsupportedPseudoSelfEffect(style: CSSStyleDeclaration): boolean {
    const opacity = Number.parseFloat(style.opacity || "1");
    const hasOpacity = Number.isFinite(opacity) && opacity > 0 && opacity < 1;
    return hasOpacity || hasCssClipPath(style) || hasUnsupportedNativeAncestorEffect(style);
  }

  function materializeLayeredPseudoBackground(
    element: HTMLElement,
    pseudo: "::before" | "::after",
  ): HTMLElement | null {
    const style = getComputedStyle(element, pseudo);
    const rawContent = (style.content || "").trim();
    const content = rawContent.toLowerCase();
    const isGenerated = content !== "" && content !== "none" && content !== "normal" && style.display !== "none";
    const materializeEntirePseudo =
      hasTextClip(style) || hasCssMask(style) || hasUnsupportedPseudoSelfEffect(style);
    if (
      !isGenerated ||
      (style.position !== "absolute" && style.position !== "fixed") ||
      !isSupportedLayeredGradient(style.backgroundImage || "") ||
      (!materializeEntirePseudo && !hasNonNormalBackgroundBlendMode(style))
    ) {
      return null;
    }

    // Materialize pseudo backgrounds whose compositing is not faithfully
    // represented by the html2canvas fallback. Chromium retains internal
    // background blending, and backdrop-dependent pseudos additionally mark
    // the authored backdrop for flattening into the same PNG.
    const background = document.createElement("od-pptx-layered-background");
    background.setAttribute("data-od-pptx-materialized-pseudo", pseudo);
    if (materializeEntirePseudo) {
      background.setAttribute("data-od-pptx-materialized-entire-pseudo", "true");
      element.setAttribute(
        pseudo === "::before" ? "data-od-pptx-suppress-before" : "data-od-pptx-suppress-after",
        "true",
      );
    }
    if (dependsOnBackdrop(style)) {
      background.setAttribute("data-od-pptx-flatten-blend-backdrop", "true");
    }
    background.setAttribute("aria-hidden", "true");
    background.style.setProperty("position", style.position, "important");
    background.style.setProperty("top", style.top || "auto", "important");
    background.style.setProperty("right", style.right || "auto", "important");
    background.style.setProperty("bottom", style.bottom || "auto", "important");
    background.style.setProperty("left", style.left || "auto", "important");
    background.style.setProperty("width", style.width || "auto", "important");
    background.style.setProperty("height", style.height || "auto", "important");
    background.style.setProperty("box-sizing", "border-box", "important");
    background.style.setProperty(
      "padding",
      `${style.paddingTop || "0px"} ${style.paddingRight || "0px"} ${style.paddingBottom || "0px"} ${style.paddingLeft || "0px"}`,
      "important",
    );
    background.style.setProperty(
      "border-width",
      `${style.borderTopWidth || "0px"} ${style.borderRightWidth || "0px"} ${style.borderBottomWidth || "0px"} ${style.borderLeftWidth || "0px"}`,
      "important",
    );
    background.style.setProperty("border-style", "solid", "important");
    background.style.setProperty("border-color", "transparent", "important");
    background.style.setProperty("border-radius", style.borderRadius || "0px", "important");
    background.style.setProperty("box-shadow", style.boxShadow || "none", "important");
    background.style.setProperty("background-color", style.backgroundColor, "important");
    background.style.setProperty("background-image", style.backgroundImage, "important");
    background.style.setProperty("background-position", style.backgroundPosition, "important");
    background.style.setProperty("background-size", style.backgroundSize, "important");
    background.style.setProperty("background-repeat", style.backgroundRepeat, "important");
    background.style.setProperty("background-origin", style.backgroundOrigin, "important");
    background.style.setProperty("background-clip", style.backgroundClip, "important");
    background.style.setProperty("background-blend-mode", style.backgroundBlendMode || "normal", "important");
    background.style.setProperty("clip-path", style.clipPath || "none", "important");
    copyComputedMaskStyles(background, style);
    background.style.setProperty("filter", style.filter || "none", "important");
    const backdropFilter =
      style.backdropFilter ||
      style.getPropertyValue?.("backdrop-filter") ||
      style.getPropertyValue?.("-webkit-backdrop-filter") ||
      "none";
    background.style.setProperty("backdrop-filter", backdropFilter, "important");
    background.style.setProperty("-webkit-backdrop-filter", backdropFilter, "important");
    background.style.setProperty("opacity", style.opacity || "1", "important");
    background.style.setProperty("mix-blend-mode", style.mixBlendMode, "important");
    background.style.setProperty("transform", style.transform || "none", "important");
    background.style.setProperty("transform-origin", style.transformOrigin || "50% 50%", "important");
    background.style.setProperty("transform-box", style.transformBox || "view-box", "important");
    background.style.setProperty("translate", style.translate || "none", "important");
    background.style.setProperty("rotate", style.rotate || "none", "important");
    background.style.setProperty("scale", style.scale || "none", "important");
    background.style.setProperty("z-index", style.zIndex || "auto", "important");
    if (materializeEntirePseudo) {
      // Text clipping, masks, and non-serializable self effects apply to the
      // pseudo's complete painted output, including generated text and borders.
      // Copy the computed pseudo style so Chromium rasterizes it as one layer.
      for (let index = 0; index < style.length; index += 1) {
        const property = style.item(index);
        if (property === "content") continue;
        const value = style.getPropertyValue(property);
        if (value) background.style.setProperty(property, value, "important");
      }
      background.textContent = rawContent.replace(/^['"]|['"]$/g, "");
    }
    background.style.setProperty("pointer-events", "none", "important");
    if (pseudo === "::before") element.prepend(background);
    else element.append(background);
    return background;
  }

  function isRenderedInsideSlide(
    element: HTMLElement,
    slide: HTMLElement,
    style: CSSStyleDeclaration,
  ): boolean {
    for (let current: HTMLElement | null = element; current; current = current.parentElement) {
      const currentStyle = current === element ? style : getComputedStyle(current);
      const visibility = currentStyle.visibility.toLowerCase();
      if (
        currentStyle.display === "none" ||
        visibility === "hidden" ||
        visibility === "collapse" ||
        Number.parseFloat(currentStyle.opacity) === 0
      ) {
        return false;
      }
      if (current === slide) break;
    }

    const targetRect = element.getBoundingClientRect();
    if (targetRect.width < 1 || targetRect.height < 1) return false;
    const slideRect = slide.getBoundingClientRect();
    const hasVisualOverflow = style.filter && style.filter !== "none";
    const padding = hasVisualOverflow
      ? Math.min(192, Math.max(64, Math.ceil(Math.max(targetRect.width, targetRect.height) / 4)))
      : 0;
    const width = Math.min(slideRect.right, targetRect.right + padding)
      - Math.max(slideRect.left, targetRect.left - padding);
    const height = Math.min(slideRect.bottom, targetRect.bottom + padding)
      - Math.max(slideRect.top, targetRect.top - padding);
    return width >= 1 && height >= 1;
  }

  function establishesCompositingContext(style: CSSStyleDeclaration): boolean {
    const opacity = Number.parseFloat(style.opacity || "1");
    const hasOpacity = Number.isFinite(opacity) && opacity > 0 && opacity < 1;
    return hasOpacity || hasUnsupportedNativeAncestorEffect(style);
  }

  function hasUnsupportedNativeAncestorEffect(style: CSSStyleDeclaration): boolean {
    const hasFilter = Boolean(style.filter && style.filter !== "none");
    const hasTransform = [style.transform, style.translate, style.rotate, style.scale]
      .some((value) => Boolean(value && value !== "none"));
    return hasFilter || hasTransform || hasCssClipPath(style) || hasCssMask(style) || dependsOnBackdrop(style);
  }

  function compositingAncestors(element: HTMLElement, slide: HTMLElement): HTMLElement[] {
    const ancestors: HTMLElement[] = [];
    let compositingBoundary = 0;
    for (let ancestor = element.parentElement; ancestor && ancestor !== slide; ancestor = ancestor.parentElement) {
      ancestors.push(ancestor);
      if (establishesCompositingContext(getComputedStyle(ancestor))) {
        compositingBoundary = ancestors.length;
      }
    }
    if (element !== slide && hasUnsupportedNativeAncestorEffect(getComputedStyle(slide))) {
      ancestors.push(slide);
      compositingBoundary = ancestors.length;
    }
    // A painted wrapper between the layered target and the outer compositor
    // participates in the same group even when it establishes no compositor
    // of its own. Keep the complete chain through the outermost boundary so
    // its fill is captured and cannot be re-emitted above the replacement PNG.
    return ancestors.slice(0, compositingBoundary);
  }

  const slides = Array.prototype.slice
    .call(document.querySelectorAll(slideSelector))
    .filter((element) => !(element as HTMLElement).closest(".mini-slide, .overview, .notes-overlay, .thumb")) as HTMLElement[];
  const targets: LayeredPptxBackgroundTarget[] = [];
  let nextId = 0;
  for (const slide of slides) {
    const authoredElements = [slide, ...Array.from(slide.querySelectorAll<HTMLElement>("*"))];
    const materializedPseudos = authoredElements.flatMap((element) =>
      (["::before", "::after"] as const)
        .map((pseudo) => materializeLayeredPseudoBackground(element, pseudo))
        .filter((element): element is HTMLElement => element !== null),
    );
    const elements = [...authoredElements, ...materializedPseudos];
    const layeredElements = elements.filter((element) => {
      const style = getComputedStyle(element);
      const capturesLayer = (
        isSupportedLayeredGradient(style.backgroundImage || "") &&
        isRenderedInsideSlide(element, slide, style)
      );
      if (
        capturesLayer &&
        (hasTextClip(style) || hasCssMask(style) || establishesCompositingContext(style)) &&
        !element.hasAttribute("data-od-pptx-materialized-pseudo")
      ) {
        // The native converter cannot reapply text clipping, masks, or
        // compositor effects to a background raster and editable foreground as
        // one CSS paint group. Keep the complete element paint in one Chromium
        // capture instead.
        element.setAttribute("data-od-pptx-capture-entire-element", "true");
        element.setAttribute("data-od-pptx-suppress-before", "true");
        element.setAttribute("data-od-pptx-suppress-after", "true");
      }
      return capturesLayer;
    });
    const captureGroups = new Map<HTMLElement, HTMLElement[]>();
    for (const element of layeredElements) {
      // PPTX has no equivalent of a DOM ancestor compositing group here. When
      // an ancestor effect encloses layered descendants, capture that outermost
      // context once instead of baking the effect into each background image.
      // Every intermediate compositor participates in that same flattened paint
      // and must have its native background cleared after capture as well.
      const ancestors = compositingAncestors(element, slide);
      for (const ancestor of ancestors) {
        if (!hasUnsupportedNativeAncestorEffect(getComputedStyle(ancestor))) continue;
        // dom-to-pptx can inherit ancestor opacity, but it cannot serialize an
        // ancestor filter, transform, blend mode, or backdrop filter onto the
        // editable foreground. Capture and suppress that affected subtree so
        // Chromium applies the unsupported effect exactly once.
        ancestor.setAttribute("data-od-pptx-capture-entire-element", "true");
        ancestor.setAttribute("data-od-pptx-suppress-before", "true");
        ancestor.setAttribute("data-od-pptx-suppress-after", "true");
      }
      const root = ancestors.at(-1) ?? element;
      const members = captureGroups.get(root) ?? [];
      for (const member of [element, ...ancestors]) {
        if (!members.includes(member)) members.push(member);
      }
      captureGroups.set(root, members);
    }

    for (const [element, members] of captureGroups) {
      const style = getComputedStyle(element);
      if (!isRenderedInsideSlide(element, slide, style)) continue;
      const id = `od-pptx-layer-${nextId++}`;
      if (members.some((member) => member !== element)) {
        // The compositor root's own background participates in the same paint
        // group even when it is a solid fill rather than a layered gradient.
        // Capture and clear it with the layered descendants so its later
        // native fill cannot cover the flattened PNG.
        const compositingMembers = members.includes(element) ? members : [element, ...members];
        element.setAttribute("data-od-pptx-compositing-context", "true");
        for (const member of compositingMembers) {
          member.setAttribute("data-od-pptx-compositing-member", id);
        }
      }
      if (dependsOnBackdrop(style) || members.some((member) => dependsOnBackdrop(getComputedStyle(member)))) {
        element.setAttribute("data-od-pptx-flatten-blend-backdrop", "true");
      }
      element.setAttribute("data-od-pptx-layer-capture-id", id);
      targets.push({ id });
    }
  }
  return targets;
}

type LayeredPptxIsolationState = {
  inlineStyles: Array<{ cssText: string; element: HTMLElement }>;
  pseudoBackdropAttributes: Array<{
    after: string | null;
    before: string | null;
    element: HTMLElement;
  }>;
  pseudoStyle: HTMLStyleElement;
};

export function restoreLayeredPptxBackgroundIsolation(): void {
  const state = (window as unknown as { __odPptxLayerIsolation?: LayeredPptxIsolationState })
    .__odPptxLayerIsolation;
  if (!state) return;
  for (const { cssText, element } of state.inlineStyles) element.style.cssText = cssText;
  for (const { after, before, element } of state.pseudoBackdropAttributes) {
    if (before === null) element.removeAttribute("data-od-pptx-blend-backdrop-before");
    else element.setAttribute("data-od-pptx-blend-backdrop-before", before);
    if (after === null) element.removeAttribute("data-od-pptx-blend-backdrop-after");
    else element.setAttribute("data-od-pptx-blend-backdrop-after", after);
  }
  state.pseudoStyle.remove();
  delete (window as unknown as { __odPptxLayerIsolation?: LayeredPptxIsolationState }).__odPptxLayerIsolation;
}

export function isolateLayeredPptxBackground(
  slideSelector: string,
  id: string,
): LayeredPptxBackgroundGeometry | null {
  restoreLayeredPptxBackgroundIsolation();
  const target = document.querySelector<HTMLElement>(`[data-od-pptx-layer-capture-id="${id}"]`);
  if (!target) return null;
  const slides = Array.prototype.slice
    .call(document.querySelectorAll(slideSelector))
    .filter((element) => !(element as HTMLElement).closest(".mini-slide, .overview, .notes-overlay, .thumb")) as HTMLElement[];
  const slideIndex = slides.findIndex((slide) => slide === target || slide.contains(target));
  if (slideIndex < 0) return null;
  const slide = slides[slideIndex]!;
  const targetStyle = getComputedStyle(target);
  const flattenBackdrop = target.getAttribute("data-od-pptx-flatten-blend-backdrop") === "true";
  const flattenCompositingContext = target.getAttribute("data-od-pptx-compositing-context") === "true";
  const materializesEntirePseudo = target.getAttribute("data-od-pptx-materialized-entire-pseudo") === "true";
  const capturesEntireElement = target.getAttribute("data-od-pptx-capture-entire-element") === "true";
  const targetRect = target.getBoundingClientRect();
  const slideRect = slide.getBoundingClientRect();
  const hasVisualOverflow = targetStyle.filter && targetStyle.filter !== "none";
  const padding = hasVisualOverflow ? Math.min(192, Math.max(64, Math.ceil(Math.max(targetRect.width, targetRect.height) / 4))) : 0;
  const left = Math.max(slideRect.left, targetRect.left - padding);
  const top = Math.max(slideRect.top, targetRect.top - padding);
  const right = Math.min(slideRect.right, targetRect.right + padding);
  const bottom = Math.min(slideRect.bottom, targetRect.bottom + padding);
  if (right - left < 1 || bottom - top < 1) return null;

  const allElements = Array.from(document.querySelectorAll<HTMLElement>("*"));
  const inlineStyles = allElements.map((element) => ({ cssText: element.style.cssText, element }));
  const compositingMembers = new Set(
    flattenCompositingContext
      ? Array.from(document.querySelectorAll<HTMLElement>(`[data-od-pptx-compositing-member="${id}"]`))
      : [],
  );
  const backdropDependentMembers = Array.from(compositingMembers).filter((element) => {
    const style = getComputedStyle(element);
    const mixBlendMode = (style.mixBlendMode || "normal").trim().toLowerCase();
    const backdropFilter = (
      style.backdropFilter ||
      style.getPropertyValue?.("backdrop-filter") ||
      style.getPropertyValue?.("-webkit-backdrop-filter") ||
      "none"
    ).trim().toLowerCase();
    return (mixBlendMode !== "" && mixBlendMode !== "normal") ||
      (backdropFilter !== "" && backdropFilter !== "none");
  });
  const backdropPaintTargets = backdropDependentMembers.length > 0
    ? backdropDependentMembers
    : [target];
  const entirePaintRoots = new Set(
    flattenCompositingContext
      ? Array.from(compositingMembers).filter((element) =>
          element.hasAttribute("data-od-pptx-capture-entire-element") ||
          element.hasAttribute("data-od-pptx-materialized-entire-pseudo"),
        )
      : capturesEntireElement || materializesEntirePseudo
        ? [target]
        : [],
  );
  const entirePaintStyles = new Map<HTMLElement, {
    color: string;
    textFillColor: string;
    textShadow: string;
    visibility: string;
  }>();
  for (const root of entirePaintRoots) {
    for (const element of [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]) {
      const style = getComputedStyle(element);
      entirePaintStyles.set(element, {
        color: style.color,
        textFillColor: style.getPropertyValue("-webkit-text-fill-color") || style.color,
        textShadow: style.textShadow || "none",
        visibility: style.visibility,
      });
    }
  }
  const blendBackdropElements = new Set<HTMLElement>();
  const blendBackdropPseudos = new Map<HTMLElement, Set<"::before" | "::after">>();
  const addBlendBackdropElement = (element: HTMLElement): void => {
    blendBackdropElements.add(element);
    const pseudos = blendBackdropPseudos.get(element) ?? new Set<"::before" | "::after">();
    pseudos.add("::before");
    pseudos.add("::after");
    blendBackdropPseudos.set(element, pseudos);
  };
  const paintsBehindTarget = (element: HTMLElement): boolean => {
    const rect = element.getBoundingClientRect();
    const intersection = {
      bottom: Math.min(bottom, rect.bottom),
      left: Math.max(left, rect.left),
      right: Math.min(right, rect.right),
      top: Math.max(top, rect.top),
    };
    if (intersection.right - intersection.left < 1 || intersection.bottom - intersection.top < 1) {
      return false;
    }
    const insetX = Math.min(1, (intersection.right - intersection.left) / 4);
    const insetY = Math.min(1, (intersection.bottom - intersection.top) / 4);
    const points: Array<[number, number]> = [
      [(intersection.left + intersection.right) / 2, (intersection.top + intersection.bottom) / 2],
      [intersection.left + insetX, intersection.top + insetY],
      [intersection.right - insetX, intersection.top + insetY],
      [intersection.left + insetX, intersection.bottom - insetY],
      [intersection.right - insetX, intersection.bottom - insetY],
    ];
    let sampledTogether = false;
    const paintsBehindAt = (x: number, y: number): boolean => {
      const paintStack = document.elementsFromPoint(x, y);
      const elementIndex = paintStack.indexOf(element);
      if (elementIndex < 0) return false;
      return backdropPaintTargets.some((paintTarget) => {
        const targetIndex = paintStack.indexOf(paintTarget);
        if (targetIndex >= 0) sampledTogether = true;
        return targetIndex >= 0 && elementIndex > targetIndex;
      });
    };
    if (points.some(([x, y]) => paintsBehindAt(x, y))) return true;

    const paintClipState = (candidate: HTMLElement): { hasClipPath: boolean; hasMask: boolean } => {
      const style = getComputedStyle(candidate);
      const clipPath = (
        style.clipPath ||
        style.getPropertyValue?.("clip-path") ||
        style.getPropertyValue?.("-webkit-clip-path") ||
        "none"
      )
        .trim()
        .toLowerCase();
      const hasMask = [
        style.maskImage || style.getPropertyValue?.("mask-image"),
        style.webkitMaskImage || style.getPropertyValue?.("-webkit-mask-image"),
      ].some((value) => Boolean(value && value.trim().toLowerCase() !== "none"));
      return { hasClipPath: clipPath !== "" && clipPath !== "none", hasMask };
    };
    const hasPaintClip = (candidate: HTMLElement): boolean => {
      const state = paintClipState(candidate);
      return state.hasClipPath || state.hasMask;
    };
    const paintClipChain = (candidate: HTMLElement): HTMLElement[] => {
      const clips: HTMLElement[] = [];
      for (let current: HTMLElement | null = candidate; current; current = current.parentElement) {
        if (hasPaintClip(current)) clips.push(current);
        if (current === slide) break;
      }
      return clips;
    };
    const clippedPaintBoxes = [
      ...paintClipChain(element),
      ...backdropPaintTargets.flatMap((paintTarget) => paintClipChain(paintTarget)),
    ]
      .filter((candidate, index, candidates) => candidates.indexOf(candidate) === index);
    if (clippedPaintBoxes.length === 0) return false;

    // A clip path or mask on either box or one of its ancestors can confine
    // real paint to a narrow stripe or ring that misses every fixed sample.
    // Expand those clips for the paint-order probe without removing them:
    // clip-path and masks establish stacking contexts, so setting them to
    // `none` can reorder the boxes and invert the result we are trying to
    // measure. The authored styles are restored before capture, where the real
    // clip/mask still shapes the PNG.
    const paintClipStyles = clippedPaintBoxes.map((candidate) => ({
      candidate,
      cssText: candidate.style.cssText,
      ...paintClipState(candidate),
    }));
    try {
      for (const { candidate, hasClipPath, hasMask } of paintClipStyles) {
        if (hasClipPath) {
          candidate.style.setProperty("clip-path", "inset(0)", "important");
          candidate.style.setProperty("-webkit-clip-path", "inset(0)", "important");
        }
        if (hasMask) {
          for (const property of ["mask", "-webkit-mask"]) {
            candidate.style.setProperty(property, "linear-gradient(#000, #000)", "important");
          }
        }
      }
      sampledTogether = false;
      if (points.some(([x, y]) => paintsBehindAt(x, y))) return true;
      if (sampledTogether) return false;
      // Nested clipping can still keep the two boxes out of Chromium's sampled
      // stack. Preserve the possible backdrop rather than dropping authored
      // paint when coverage remains uncertain.
      return true;
    } finally {
      for (const { candidate, cssText } of paintClipStyles) {
        candidate.style.cssText = cssText;
      }
    }
  };
  if (flattenBackdrop) {
    // Hit testing is Chromium's public view of the effective paint stack. Make
    // pointer-events:none export shims participate temporarily, then use their
    // actual order rather than assuming that DOM order is paint order.
    for (const element of allElements) {
      element.style.setProperty("pointer-events", "auto", "important");
    }
    for (const element of [slide, ...Array.from(slide.querySelectorAll<HTMLElement>("*"))]) {
      const isCapturedDescendant = target.contains(element) && (
        !flattenCompositingContext || compositingMembers.has(element)
      );
      if (element === target || element.contains(target) || isCapturedDescendant) continue;
      if (paintsBehindTarget(element)) addBlendBackdropElement(element);
    }

    const materializedPseudo = target.getAttribute("data-od-pptx-materialized-pseudo");
    for (let branch: HTMLElement | null = target; branch && branch !== slide; branch = branch.parentElement) {
      const parent: HTMLElement | null = branch.parentElement;
      if (!parent) break;
      blendBackdropElements.add(parent);
      // An ancestor's ::before paints before its child content and is part of
      // that child's blend backdrop. For a materialized ::before target, the
      // immediate parent's pseudo is the source layer itself, not its backdrop.
      if (!(branch === target && materializedPseudo === "::before")) {
        const pseudos = blendBackdropPseudos.get(parent) ?? new Set<"::before" | "::after">();
        pseudos.add("::before");
        blendBackdropPseudos.set(parent, pseudos);
      }
    }
  }
  const pseudoBackdropAttributes = Array.from(blendBackdropPseudos, ([element, pseudos]) => ({
    after: element.getAttribute("data-od-pptx-blend-backdrop-after"),
    before: element.getAttribute("data-od-pptx-blend-backdrop-before"),
    element,
    pseudos,
  }));
  for (const { element, pseudos } of pseudoBackdropAttributes) {
    if (pseudos.has("::before")) element.setAttribute("data-od-pptx-blend-backdrop-before", id);
    if (pseudos.has("::after")) element.setAttribute("data-od-pptx-blend-backdrop-after", id);
  }
  const pseudoStyle = document.createElement("style");
  const entireElementPseudoScope = flattenCompositingContext
    ? `[data-od-pptx-compositing-member="${id}"][data-od-pptx-capture-entire-element="true"]`
    : `[data-od-pptx-layer-capture-id="${id}"][data-od-pptx-capture-entire-element="true"]`;
  pseudoStyle.textContent = `
    *::before,*::after{visibility:hidden!important}
    [data-od-pptx-blend-backdrop-before="${id}"]::before,
    [data-od-pptx-blend-backdrop-after="${id}"]::after{
      visibility:visible!important;
      color:transparent!important;
      text-shadow:none!important;
      -webkit-text-fill-color:transparent!important;
    }
    ${capturesEntireElement || Array.from(entirePaintRoots).some((element) => element.hasAttribute("data-od-pptx-capture-entire-element")) ? `
      ${entireElementPseudoScope}::before,
      ${entireElementPseudoScope}::after,
      ${entireElementPseudoScope} *::before,
      ${entireElementPseudoScope} *::after{
        visibility:visible!important;
      }
    ` : ""}
  `;
  document.head.append(pseudoStyle);
  (window as unknown as { __odPptxLayerIsolation?: LayeredPptxIsolationState }).__odPptxLayerIsolation = {
    inlineStyles,
    pseudoBackdropAttributes,
    pseudoStyle,
  };

  for (const element of allElements) element.style.setProperty("visibility", "hidden", "important");
  for (const element of blendBackdropElements) {
    element.style.setProperty("visibility", "visible", "important");
    element.style.setProperty("color", "transparent", "important");
    element.style.setProperty("outline", "none", "important");
    element.style.setProperty("text-shadow", "none", "important");
    element.style.setProperty("-webkit-text-fill-color", "transparent", "important");
  }
  for (let ancestor: HTMLElement | null = target; ancestor; ancestor = ancestor.parentElement) {
    ancestor.style.setProperty("visibility", "visible", "important");
    if (ancestor !== target) {
      if (!flattenBackdrop) {
        ancestor.style.setProperty("background", "transparent", "important");
        ancestor.style.setProperty("border-color", "transparent", "important");
        ancestor.style.setProperty("box-shadow", "none", "important");
      }
      ancestor.style.setProperty("color", "transparent", "important");
      ancestor.style.setProperty("outline", "none", "important");
      ancestor.style.setProperty("text-shadow", "none", "important");
    }
  }
  for (const descendant of Array.from(target.querySelectorAll<HTMLElement>("*"))) {
    const entirePaintRoot = Array.from(entirePaintRoots).find((root) => root === descendant || root.contains(descendant));
    if (entirePaintRoot) {
      descendant.style.setProperty(
        "visibility",
        entirePaintStyles.get(descendant)?.visibility || "visible",
        "important",
      );
      continue;
    }
    if (blendBackdropElements.has(descendant)) continue;
    if (!flattenCompositingContext) {
      descendant.style.setProperty("visibility", "hidden", "important");
      continue;
    }
    const carriesCapturedBackground = compositingMembers.has(descendant);
    const containsCapturedBackground = Array.from(compositingMembers).some((member) => descendant.contains(member));
    if (!carriesCapturedBackground && !containsCapturedBackground) {
      descendant.style.setProperty("visibility", "hidden", "important");
      continue;
    }
    descendant.style.setProperty("visibility", "visible", "important");
    if (!carriesCapturedBackground) {
      descendant.style.setProperty("background", "transparent", "important");
    }
    descendant.style.setProperty("border-color", "transparent", "important");
    descendant.style.setProperty("box-shadow", "none", "important");
    descendant.style.setProperty("color", "transparent", "important");
    descendant.style.setProperty("outline", "none", "important");
    descendant.style.setProperty("text-shadow", "none", "important");
    descendant.style.setProperty("-webkit-text-fill-color", "transparent", "important");
  }
  // Replaced content is painted by the target itself rather than a descendant.
  // Move that object outside its content box for this screenshot while leaving
  // the target's CSS background visible; restore replays the saved inline style.
  if (!capturesEntireElement && ["IMG", "CANVAS", "VIDEO"].includes(target.tagName)) {
    target.style.setProperty("object-position", "1000000px 1000000px", "important");
  }
  if (flattenCompositingContext && !entirePaintRoots.has(target)) {
    if (!compositingMembers.has(target)) {
      target.style.setProperty("background", "transparent", "important");
    }
    target.style.setProperty("border-color", "transparent", "important");
    target.style.setProperty("box-shadow", "none", "important");
    target.style.setProperty("color", "transparent", "important");
    target.style.setProperty("outline", "none", "important");
    target.style.setProperty("text-shadow", "none", "important");
    target.style.setProperty("-webkit-text-fill-color", "transparent", "important");
  } else if (!materializesEntirePseudo && !capturesEntireElement) {
    target.style.setProperty("border-color", "transparent", "important");
    target.style.setProperty("box-shadow", "none", "important");
    target.style.setProperty("color", "transparent", "important");
    target.style.setProperty("text-shadow", "none", "important");
    target.style.setProperty("-webkit-text-fill-color", "transparent", "important");
  }
  for (const [element, style] of entirePaintStyles) {
    element.style.setProperty("visibility", style.visibility, "important");
    element.style.setProperty("color", style.color, "important");
    element.style.setProperty("text-shadow", style.textShadow, "important");
    element.style.setProperty("-webkit-text-fill-color", style.textFillColor, "important");
  }
  for (const root of [document.documentElement, document.body]) {
    if (!root) continue;
    root.style.setProperty("visibility", "visible", "important");
    if (!flattenBackdrop) root.style.setProperty("background", "transparent", "important");
  }

  return {
    height: bottom - top,
    left: left - slideRect.left,
    pageX: left + window.scrollX,
    pageY: top + window.scrollY,
    slideIndex,
    top: top - slideRect.top,
    width: right - left,
  };
}


export function showAllSlides(slideSelector: string): number {
  const slides = Array.prototype.slice
    .call(document.querySelectorAll(slideSelector))
    .filter((el) => !(el as HTMLElement).closest(".mini-slide, .overview, .notes-overlay, .thumb"));
  for (const node of slides) {
    const el = node as HTMLElement;
    // Reveal every page for export, including slides hidden by the shared
    // deck-stage fallback or by authored navigation styles.
    el.setAttribute("data-od-deck-active", "");
    el.setAttribute("aria-hidden", "false");
    el.removeAttribute("hidden");
    el.style.setProperty("opacity", "1", "important");
    el.style.setProperty("visibility", "visible", "important");
    el.style.setProperty("position", "absolute", "important");
    el.style.setProperty("left", "0", "important");
    el.style.setProperty("top", "0", "important");
    ["active", "visible", "is-active", "current"].forEach((c) => el.classList.add(c));
  }
  return slides.length;
}

