import type { IDocumentData, IStyleData } from '@univerjs/core';
const fontKeys = new Set(['ff', 'fs', 'bl', 'it', 'st', 'ul', 'va', 'cl']);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** Only after live renderer-default admission. Remove redundant defaults from
 * one plain paragraph so the SDK itself chooses scalar/formula/text semantics.
 * Any authored/unknown structure or different run style keeps its original path. */
export function defaultWorkbookCellInput(doc: IDocumentData, style: IStyleData): IDocumentData | undefined {
  for (const [key, value] of Object.entries(doc)) {
    if (['id', 'body', 'documentStyle'].includes(key) || value == null) continue;
    if (['drawings','headers','footers','notes','noteSettings','settings','tableSource'].includes(key)
      && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) continue;
    if (key === 'drawingsOrder' && Array.isArray(value) && value.length === 0) continue;
    if (key === 'title' && value === '' || key === 'locale' && value === 'enUS') continue;
    return;
  }
  if (Object.keys(doc.documentStyle ?? {}).length) return;
  const body = doc.body;
  if (!body || typeof body.dataStream !== 'string' || !body.dataStream.endsWith('\r\n')) return;
  const text = body.dataStream.slice(0,-2);
  if (/[\r\n]/.test(text) || text.length > 32767 || (body.textRuns?.length ?? 0) > 1024) return;
  const boundary = (at: number) => !(at > 0 && at < text.length
    && /[\uD800-\uDBFF]/.test(text[at - 1]!) && /[\uDC00-\uDFFF]/.test(text[at]!));
  for (const [key, value] of Object.entries(body)) {
    if (['dataStream','textRuns','paragraphs'].includes(key) || value == null) continue;
    if (['sectionBreaks','customRanges','customBlocks','customDecorations','tables'].includes(key)
      && Array.isArray(value) && value.length === 0) continue;
    return;
  }
  if ((body.paragraphs?.length ?? 0) > 1 || body.paragraphs?.some(p => p.startIndex !== text.length
    || p.paragraphId !== undefined && typeof p.paragraphId !== 'string'
    || Object.keys(p).some(key => !['startIndex','paragraphId'].includes(key)))) return;
  let end = 0;
  for (const run of body.textRuns ?? []) {
    if (Object.keys(run).some(key => !['st','ed','ts'].includes(key)) || !Number.isSafeInteger(run.st) || !Number.isSafeInteger(run.ed)
      || run.st < end || run.ed < run.st || run.st > text.length || run.ed > text.length + 1
      || !boundary(run.st) || !boundary(Math.min(run.ed, text.length))) return;
    for (const [key, value] of Object.entries(run.ts ?? {})) {
      if (value != null && (!fontKeys.has(key) || typeof value === 'number' && !Number.isFinite(value)
        || !same(value, style[key as keyof IStyleData]))) return;
    }
    end = run.ed;
  }
  const result = structuredClone(doc);
  delete result.body!.textRuns;
  return result;
}
