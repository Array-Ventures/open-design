import type { DefaultTreeAdapterTypes } from 'parse5';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import colorNames from 'color-name';
import { DECK_EXPLICIT_SLIDE_MARKERS } from '@open-design/contracts/runtime/deck-stage-fallback';
import { findSpeakerNotesScriptBlock } from '@open-design/contracts/runtime/speaker-notes';
import { stageIn } from './deck-properties';

type Element = DefaultTreeAdapterTypes.Element;
const slideClasses = new Set(DECK_EXPLICIT_SLIDE_MARKERS.map(selector => selector.slice(1)));
const isSlide = (node: Element) => node.attrs.some(attr => attr.name === 'data-screen-label'
  || attr.name === 'class' && attr.value.split(/\s+/).some(value => slideClasses.has(value)));

/** Match the canonical stage runtime: prefer direct slides, otherwise only
 * outermost marked descendants. Templates and nested slide content are inert. */
function slidesIn(source: string): Element[] {
  const stage = stageIn(source);
  if (!stage) return [];
  const nested: Element[] = [];
  function visit(parent: Element) {
    for (const child of parent.childNodes) {
      if (!('tagName' in child)) continue;
      if (isSlide(child)) nested.push(child);
      visit(child);
    }
  }
  visit(stage);
  const direct = nested.filter(node => node.parentNode === stage);
  return direct.length ? direct : nested.filter(node => {
    let parent = node.parentNode;
    while (parent && parent !== stage) {
      if ('tagName' in parent && isSlide(parent)) return false;
      parent = 'parentNode' in parent ? parent.parentNode : null;
    }
    return true;
  });
}

/** Reserved paths are stamped before authored scripts run. A runtime reorder
 * therefore retains the source node's identity instead of changing its owner. */
export function deckSlideIndexForSourcePath(source: string, path: string): number | null {
  if (!/^path(?:-\d+)+$/.test(path) || path.length > 500) return null;
  // FileViewer removes the nonvisual notes block before building srcdoc. Match
  // that visual tree while preserving the raw source's slide ordinal for writes.
  const notes = findSpeakerNotesScriptBlock(source);
  const visual = notes ? source.slice(0, notes.start) + source.slice(notes.end) : source;
  const slides = slidesIn(visual);
  if (slides.length !== slidesIn(source).length) return null;
  const matches = slides.flatMap((slide, index) => {
    const parts: number[] = [];
    let node: DefaultTreeAdapterTypes.Node = slide;
    while ('tagName' in node && node.tagName !== 'body') {
      const parent: DefaultTreeAdapterTypes.ParentNode | null = node.parentNode;
      if (!parent || !('childNodes' in parent)) return [];
      parts.unshift(parent.childNodes.filter(child => 'tagName' in child).indexOf(node));
      node = parent;
    }
    return 'tagName' in node && node.tagName === 'body' && `path-${parts.join('-')}` === path ? [index] : [];
  });
  return matches.length === 1 ? matches[0]! : null;
}

function parseInlineStyle(raw: string) {
  try {
    const css = postcss.parse(raw, { from: undefined });
    return css.nodes.some(node => node.type !== 'decl' && node.type !== 'comment') ? null : css;
  } catch { return null; }
}

function readableColor(value: string, shorthand: boolean): string {
  let color = value;
  if (shorthand) {
    const nodes = valueParser(value).nodes.filter(node => node.type !== 'space' && node.type !== 'comment' && node.type !== 'div');
    const colors = nodes.filter(node => node.type === 'word' && (/^#[\da-f]{3,8}$/i.test(node.value) || node.value.toLowerCase() === 'transparent' || Object.hasOwn(colorNames,node.value.toLowerCase()))
      || node.type === 'function' && /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark|device-cmyk|var|env)$/i.test(node.value));
    if (colors.length > 1) return value;
    if (colors.length === 1) color = valueParser.stringify(colors[0]!);
    else {
      const known = nodes.every(node => node.type === 'function' && /^(?:url|(?:repeating-)?(?:linear|radial|conic)-gradient|image|image-set|cross-fade|calc|min|max|clamp)$/i.test(node.value)
        || node.type === 'word' && /^(?:none|repeat(?:-x|-y)?|no-repeat|space|round|scroll|fixed|local|left|right|top|bottom|center|cover|contain|padding-box|border-box|content-box|text|-?\d*\.?\d+(?:[a-z]+|%)?)$/i.test(node.value));
      if (!known) return value;
      color = 'transparent';
    }
  }
  if (color.toLowerCase() === 'transparent') return 'rgba(0, 0, 0, 0)';
  const named = Object.hasOwn(colorNames,color.toLowerCase()) ? colorNames[color.toLowerCase() as keyof typeof colorNames] : null;
  return named ? `rgb(${named.join(', ')})` : color;
}

export function readDeckSlideBackground(source: string, index: number): { color: string; count: number; editable: boolean } | null {
  const slides = slidesIn(source);
  const slide = Number.isInteger(index) && index >= 0 ? slides[index] : undefined;
  if (!slide?.sourceCodeLocation?.startTag) return null;
  const raw = slide.attrs.find(attr => attr.name === 'style')?.value ?? '';
  const css = parseInlineStyle(raw);
  const declarations = css?.nodes.filter(node => node.type === 'decl' && /^(?:background|background-color)$/i.test(node.prop)) ?? [];
  const winner = [...declarations].reverse().find(node => node.type === 'decl' && node.important) ?? declarations.at(-1);
  // Reading stays DOM-independent for server rendering. Complex shorthand or
  // variable values are shown as custom, never misreported as a resolved color.
  return { color: winner?.type === 'decl' ? readableColor(winner.value,winner.prop.toLowerCase() === 'background') : '', count: slides.length, editable: css !== null };
}

/** Rewrite only the selected slide's style attribute. The existing conditional
 * source writer and history retain ownership of save, conflict and undo. */
export function setDeckSlideBackground(source: string, index: number, color: string): string | null {
  if (!/^#(?:[\da-f]{6}|[\da-f]{8})$/i.test(color)) return null;
  const slides = slidesIn(source);
  const slide = Number.isInteger(index) && index >= 0 ? slides[index] : undefined;
  const tag = slide?.sourceCodeLocation?.startTag;
  if (!slide || !tag) return null;
  const raw = slide.attrs.find(attr => attr.name === 'style')?.value ?? '';
  const css = parseInlineStyle(raw);
  if (!css) return null;
  const last = css.nodes.at(-1);
  if (last?.type === 'decl' && last.prop.toLowerCase() === 'background-color' && last.value.toLowerCase() === color.toLowerCase() && last.important) return source;
  css.walkDecls(/^background-color$/i, declaration => { declaration.remove(); });
  // Retain shorthand image/position/size declarations and append the color
  // after them. CSSOM serialization can expand and reorder those declarations.
  css.append({ prop: 'background-color', value: color.toLowerCase(), important: true });
  css.raws.semicolon = true;
  const value = css.toString().replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const attribute = `style="${value}"`;
  const location = slide.sourceCodeLocation?.attrs?.style;
  if (location) return source.slice(0, location.startOffset) + attribute + source.slice(location.endOffset);
  return source.slice(0, tag.endOffset - 1) + ' ' + attribute + source.slice(tag.endOffset - 1);
}
