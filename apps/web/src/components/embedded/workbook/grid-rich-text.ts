import { BaselineOffset, TextDecoration, type ICellData, type IStyleBase } from '@univerjs/core';
import {
  workbookCellSchema,
  workbookFontSchema,
  type WorkbookCell,
  type WorkbookDocument,
  type WorkbookFont,
} from '@open-design/contracts/runtime/workbook';
import { workbookGridRunFont } from './grid-model';
export class WorkbookRichTextError extends Error {}
const refuse = (message: string): never => {
  throw new WorkbookRichTextError(message);
};
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v)
            .filter(([, value]) => value !== undefined && value !== null)
            .sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
const same = (a: unknown, b: unknown) => canonical(a ?? {}) === canonical(b ?? {});
const fields = new Set(['ff', 'fs', 'bl', 'it', 'st', 'ul', 'va', 'cl']);
function color(value: unknown): WorkbookFont['color'] {
  if (value == null) return;
  const c = value as { rgb?: unknown };
  if (typeof c !== 'object' || Object.keys(c).some((key) => key !== 'rgb') || typeof c.rgb !== 'string')
    return refuse('This rich text color is not supported.');
  const hex = /^#([a-f\d]{6})([a-f\d]{2})?$/i.exec(c.rgb);
  if (hex) return { kind: 'rgb', argb: `${hex[2] ?? 'FF'}${hex[1]}`.toUpperCase() };
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/i.exec(c.rgb);
  if (rgb) {
    const channels = rgb.slice(1, 4).map(Number),
      alpha = Math.round(Number(rgb[4] ?? 1) * 255);
    if (channels.some((n) => n > 255)) return refuse('Invalid rich text color.');
    return {
      kind: 'rgb',
      argb: [alpha, ...channels]
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase(),
    };
  }
  return refuse('This rich text color is not supported.');
}
function colorIdentity(value: unknown): string {
  try {
    return canonical(color(value));
  } catch {
    return canonical(value);
  }
}
function sameFontName(value: unknown, font: WorkbookFont | undefined): boolean {
  if (typeof value !== 'string' || !font?.name || /[,"'\\\u0000-\u001f\u007f]/.test(font.name)) return false;
  const unquoted = /^(?:"[^"\\]*"|'[^'\\]*')$/.test(value) ? value.slice(1, -1) : value;
  return value === font.name || unquoted === font.name;
}
function fontFromStyle(
  style: IStyleBase,
  base: WorkbookFont | undefined,
  model: WorkbookDocument,
): WorkbookFont | undefined {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return refuse('Invalid rich text style.');
  for (const [key, value] of Object.entries(style))
    if (value != null && !fields.has(key)) refuse('This rich text font property is not supported.');
  const projected = workbookGridRunFont(base, model, new Set()),
    font: WorkbookFont = {};
  const preserve = (key: keyof IStyleBase) => same(style[key], projected[key]);
  if (preserve('ff') || sameFontName(style.ff, base)) {
    if (base?.name !== undefined) font.name = base.name;
    if (base?.family !== undefined) font.family = base.family;
  } else if (style.ff != null) {
    if (typeof style.ff !== 'string' || !style.ff || /[,\\]/.test(style.ff))
      refuse('This rich font family cannot be represented safely.');
    let name = style.ff;
    if (/^(['"]).*\1$/.test(name)) name = name.slice(1, -1);
    if (/["']/.test(name)) refuse('This rich font family cannot be represented safely.');
    const generic = ({ serif: 1, 'sans-serif': 2, monospace: 3, cursive: 4, fantasy: 5 } as Record<string, number>)[
      name
    ];
    if (generic !== undefined) font.family = generic;
    else font.name = name;
  }
  if (preserve('fs')) {
    if (base?.size !== undefined) font.size = base.size;
  } else if (style.fs != null) font.size = style.fs;
  for (const [key, property] of [
    ['bl', 'bold'],
    ['it', 'italic'],
  ] as const) {
    if (preserve(key)) {
      if (base?.[property] !== undefined) font[property] = base[property];
    } else if (style[key] != null) {
      if (style[key] !== 0 && style[key] !== 1) refuse('Invalid rich font boolean.');
      font[property] = style[key] === 1;
    }
  }
  if (preserve('st')) {
    if (base?.strike !== undefined) font.strike = base.strike;
  } else if (style.st != null) {
    if (Object.keys(style.st).some((key) => key !== 's') || (style.st.s !== 0 && style.st.s !== 1))
      refuse('This rich strike style is not supported.');
    font.strike = style.st.s === 1;
  }
  if (preserve('ul')) {
    if (base?.underline !== undefined) font.underline = base.underline;
  } else if (style.ul != null) {
    if (Object.keys(style.ul).some((key) => key !== 's' && key !== 't') || (style.ul.s !== 0 && style.ul.s !== 1))
      refuse('This rich underline style is not supported.');
    if (style.ul.s === 0 || style.ul.t === TextDecoration.NONE) font.underline = 'none';
    else if (style.ul.s === 1) {
      const type = (
        {
          [TextDecoration.SINGLE]: 'single',
          [TextDecoration.DOUBLE]: 'double',
          [TextDecoration.SINGLE_ACCOUNTING]: 'singleAccounting',
          [TextDecoration.DOUBLE_ACCOUNTING]: 'doubleAccounting',
        } as Partial<Record<TextDecoration, WorkbookFont['underline']>>
      )[style.ul.t ?? TextDecoration.SINGLE];
      if (!type) refuse('This rich underline style is not supported.');
      font.underline = type;
    }
  }
  if (preserve('va')) {
    if (base?.vertical !== undefined) font.vertical = base.vertical;
  } else if (style.va != null) {
    if (style.va === BaselineOffset.SUPERSCRIPT) font.vertical = 'superscript';
    else if (style.va === BaselineOffset.SUBSCRIPT) font.vertical = 'subscript';
    else if (style.va === BaselineOffset.NORMAL) font.vertical = 'baseline';
    else refuse('This rich baseline style is not supported.');
  }
  if (
    preserve('cl') ||
    (style.cl != null && projected.cl != null && colorIdentity(style.cl) === colorIdentity(projected.cl))
  ) {
    if (base?.color) font.color = structuredClone(base.color);
  } else if (style.cl != null) font.color = color(style.cl);
  const parsed = workbookFontSchema.parse(font);
  return Object.keys(parsed).length ? parsed : undefined;
}
function sourceFontIndex(fonts: (WorkbookFont | undefined)[], model: WorkbookDocument) {
  const exact = new Map<string, Map<string, WorkbookFont | undefined>>(),
    metadata = { ff: new Map<string, Map<string, object>>(), cl: new Map<string, Map<string, object>>() };
  for (const font of fonts) {
    const projected = workbookGridRunFont(font, model, new Set()),
      identity = canonical(projected),
      matches = exact.get(identity) ?? new Map();
    matches.set(canonical(font), font);
    exact.set(identity, matches);
    for (const [key, properties] of [
      ['ff', ['name', 'family']],
      ['cl', ['color']],
    ] as const) {
      const value = Object.fromEntries(
        properties.filter((property) => font?.[property] !== undefined).map((property) => [property, font![property]]),
      );
      const aliases =
        key === 'ff' && font?.name && sameFontName(font.name, font)
          ? [projected[key], font.name, `"${font.name}"`, `'${font.name}'`]
          : [projected[key]];
      for (const alias of aliases) {
        const id = key === 'cl' ? colorIdentity(alias) : canonical(alias),
          choices = metadata[key].get(id) ?? new Map();
        choices.set(canonical(value), value);
        metadata[key].set(id, choices);
      }
    }
  }
  return (style: IStyleBase) => {
    const matches = exact.get(canonical(style));
    if (matches && matches.size > 1) refuse('This rich edit has ambiguous source font metadata.');
    if (matches?.size === 1) return matches.values().next().value;
    const base: WorkbookFont = {};
    for (const key of ['ff', 'cl'] as const) {
      const choices = metadata[key].get(key === 'cl' ? colorIdentity(style[key]) : canonical(style[key]));
      if (choices && choices.size > 1) refuse('This rich edit has ambiguous source font metadata.');
      Object.assign(base, choices?.values().next().value ?? {});
    }
    return Object.keys(base).length ? base : undefined;
  };
}
/** Decode public SDK UTF-16 intervals. Unstyled gaps are real text, not missing
 * runs. Document-only features must fail explicitly instead of being flattened. */
export function workbookRichText(
  cell: ICellData,
  original: WorkbookCell | undefined,
  model: WorkbookDocument,
): { value: string; runs?: { text: string; font?: WorkbookFont }[] } | undefined {
  const doc = cell.p;
  if (!doc) return;
  const body = doc.body;
  if (!body || typeof body.dataStream !== 'string' || !body.dataStream.endsWith('\r\n'))
    return refuse('The rich cell has no valid SDK text terminator.');
  for (const [key, value] of Object.entries(doc))
    if (
      !['id', 'body', 'documentStyle', 'drawings', 'drawingsOrder'].includes(key) &&
      value != null &&
      !(
        ['headers', 'footers', 'notes', 'noteSettings', 'settings', 'tableSource'].includes(key) &&
        typeof value === 'object' &&
        Object.keys(value).length === 0
      ) &&
      !(key === 'title' && value === '') &&
      !(key === 'locale' && value === 'enUS')
    )
      refuse('This rich cell document property is not supported.');
  if (
    Object.keys(doc.documentStyle ?? {}).length ||
    Object.keys(doc.drawings ?? {}).length ||
    doc.drawingsOrder?.length
  )
    refuse('Rich cell drawings or document formatting are not supported.');
  for (const [key, value] of Object.entries(body))
    if (
      ![
        'dataStream',
        'textRuns',
        'paragraphs',
        'sectionBreaks',
        'customRanges',
        'customBlocks',
        'customDecorations',
        'tables',
      ].includes(key) &&
      value != null
    )
      refuse('This rich cell structure is not supported.');
  for (const key of ['customRanges', 'customBlocks', 'customDecorations', 'tables'] as const)
    if (body[key]?.length) refuse('Annotated or structured rich cells cannot be saved yet.');
  if (body.dataStream.length > 32769 || (body.textRuns?.length ?? 0) > 1024)
    refuse('Rich cell text or run count exceeds its limit.');
  const value = body.dataStream.slice(0, -2),
    boundary = (at: number) =>
      Number.isSafeInteger(at) &&
      at >= 0 &&
      at <= value.length &&
      !(at > 0 && at < value.length && /[\uD800-\uDBFF]/.test(value[at - 1]!) && /[\uDC00-\uDFFF]/.test(value[at]!));
  for (const paragraph of body.paragraphs ?? [])
    if (
      Object.keys(paragraph).some((key) => !['startIndex', 'paragraphId'].includes(key)) ||
      !Number.isSafeInteger(paragraph.startIndex) ||
      paragraph.startIndex < 0 ||
      paragraph.startIndex > value.length ||
      body.dataStream[paragraph.startIndex] !== '\r'
    )
      refuse('Rich paragraph formatting cannot be saved yet.');
  for (const section of body.sectionBreaks ?? [])
    if (
      Object.keys(section).some((key) => !['startIndex', 'sectionId'].includes(key)) ||
      !Number.isSafeInteger(section.startIndex) ||
      body.dataStream[section.startIndex] !== '\n'
    )
      refuse('Rich section formatting cannot be saved yet.');
  const spans: { st: number; ed: number; ts: IStyleBase }[] = [];
  let end = 0;
  for (const run of body.textRuns ?? []) {
    if (
      Object.keys(run).some((key) => !['st', 'ed', 'ts'].includes(key)) ||
      !Number.isSafeInteger(run.st) ||
      !Number.isSafeInteger(run.ed) ||
      run.st < end ||
      run.ed < run.st ||
      run.ed > value.length + 1 ||
      run.st > value.length ||
      !boundary(Math.min(run.st, value.length)) ||
      !boundary(Math.min(run.ed, value.length))
    )
      refuse('Rich text run ranges are invalid or overlap.');
    if (run.st > end) spans.push({ st: end, ed: run.st, ts: {} });
    const ed = Math.min(run.ed, value.length);
    if (ed >= run.st) spans.push({ st: run.st, ed, ts: run.ts ?? {} });
    end = ed;
  }
  if (end < value.length) spans.push({ st: end, ed: value.length, ts: {} });
  const source = original?.kind === 'string' ? original : undefined,
    oldRuns = source?.runs ?? [],
    oldSpans: { st: number; ed: number; font: WorkbookFont | undefined }[] = [];
  let offset = 0;
  for (const run of oldRuns) {
    oldSpans.push({ st: offset, ed: offset + run.text.length, font: run.font });
    offset += run.text.length;
  }
  const runs: { text: string; font?: WorkbookFont }[] = [],
    indexedFont = sourceFontIndex(
      oldRuns.map((run) => run.font),
      model,
    );
  const append = (st: number, ed: number, style: IStyleBase, base: WorkbookFont | undefined) => {
    const font = fontFromStyle(style, base, model);
    runs.push({ text: value.slice(st, ed), ...(font ? { font } : {}) });
  };
  let oldIndex = 0;
  for (const [index, span] of spans.entries()) {
    if (span.st === span.ed)
      append(span.st, span.ed, span.ts, oldRuns.length === spans.length ? oldRuns[index]?.font : indexedFont(span.ts));
    else if (source?.value === value && oldSpans.length) {
      while (oldIndex < oldSpans.length && oldSpans[oldIndex]!.ed <= span.st) oldIndex++;
      for (let cursor = oldIndex; cursor < oldSpans.length && oldSpans[cursor]!.st < span.ed; cursor++) {
        const old = oldSpans[cursor]!;
        const st = Math.max(span.st, old.st),
          ed = Math.min(span.ed, old.ed);
        if (ed > st) append(st, ed, span.ts, old.font);
      }
    } else if (oldRuns.length === spans.length) append(span.st, span.ed, span.ts, oldRuns[index]?.font);
    else append(span.st, span.ed, span.ts, indexedFont(span.ts));
  }
  if (!runs.length && oldRuns.length === 1 && value === '')
    append(0, 0, body.textRuns?.[0]?.ts ?? {}, oldRuns[0]?.font);
  const rich = source?.runs !== undefined || runs.some((run) => run.font) ? { runs } : {};
  const parsed = workbookCellSchema.parse({ row: 0, column: 0, kind: 'string', value, ...rich });
  return {
    value: parsed.kind === 'string' ? parsed.value : value,
    ...(parsed.kind === 'string' && parsed.runs ? { runs: parsed.runs } : {}),
  };
}
