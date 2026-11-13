import type { WorkbookFont } from '@open-design/contracts/runtime/workbook';

/** OOXML family is source metadata, not a guess based on the font's name.
 * Missing/unknown classification uses a neutral sans-serif presentation default.
 * Office families: 1 Roman, 2 Swiss, 3 Modern, 4 Script, 5 Decorative. */
export function workbookFontFamily(font: WorkbookFont): { value?: string; limited: boolean } {
  const fallback = ({ 1: 'serif', 2: 'sans-serif', 3: 'monospace', 4: 'cursive', 5: 'fantasy' } as Record<number, string>)[font.family ?? 0] ?? 'sans-serif';
  if (font.name === undefined) return { ...(font.family === undefined ? {} : { value: fallback }), limited: false };
  // The pinned renderer splits ff at every comma, including quoted commas, and
  // re-escapes supplied CSS escapes. Such names cannot be faithfully represented
  // through that API. Use the declared generic and report the display limit;
  // the retained source font name and font XML remain untouched.
  const name = font.name;
  if (!name || /[,"'\\\u0000-\u001f\u007f]/u.test(name) || /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|emoji|math|fangsong|inherit|initial|unset|revert|revert-layer)$/i.test(name)) return { value: fallback, limited: true };
  return { value: `"${name}", ${fallback}`, limited: false };
}
