import { z } from 'zod';
import { canonicalCommentJson } from './comment-write-json';
export { canonicalCommentJson } from './comment-write-json';
import { WORKBOOK_MODEL_LIMITS, workbookDocumentSchema, workbookSheetSchema, workbookStyleSchema, type WorkbookDocument } from './workbook';

import { WORKBOOK_SHEET_BASELINE_VERSION } from './workbook-sheet-baseline-identity.js';
export { WORKBOOK_SHEET_BASELINE_VERSION, workbookSheetBaselineIdentitySchema, type WorkbookSheetBaselineIdentity } from './workbook-sheet-baseline-identity.js';
export const WORKBOOK_SHEET_BASELINE_LIMITS = { depth: 64, nodes: 4_000_000, text: 64 * 1024 * 1024, bytes: 64 * 1024 * 1024 } as const;
const document = workbookDocumentSchema.innerType().shape;
const sheetIdentity = workbookSheetSchema.pick({ id: true, name: true });
function referencedStyles(sheet: z.infer<typeof workbookSheetSchema>): number[] {
  // The grid's defaultStyle is always 0. Explicit cell, row and column styles
  // retain their complete effective definitions, including inherited formats.
  const ids = new Set([0]);
  for (const cell of sheet.cells) if (cell.style !== undefined) ids.add(cell.style);
  for (const dimension of [...sheet.rowDimensions, ...sheet.columnDimensions]) if (dimension.style !== undefined) ids.add(dimension.style);
  return [...ids].sort((a, b) => a - b);
}
export const workbookSheetBaselineSchema = z.object({
  kind: z.literal('evebot-workbook-selected-sheet'), version: z.literal(WORKBOOK_SHEET_BASELINE_VERSION),
  date1904: document.date1904, themeColors: document.themeColors,
  calculationMetadata: document.calculationMetadata, richTextMetadata: document.richTextMetadata,
  worksheetStructureEditable: document.worksheetStructureEditable, worksheetVisibilityEditable: document.worksheetVisibilityEditable,
  features: document.features, sheetIdentities: z.array(sheetIdentity).min(1).max(WORKBOOK_MODEL_LIMITS.sheets),
  definedNames: document.definedNames, tables: document.tables,
  sheet: workbookSheetSchema,
  styleDefinitions: z.array(z.object({ index: z.number().int().min(0).max(WORKBOOK_MODEL_LIMITS.styles - 1), style: workbookStyleSchema }).strict()).min(1).max(WORKBOOK_MODEL_LIMITS.styles),
}).strict().superRefine((baseline, context) => {
  const ids = new Set<string>(), names = new Set<string>();
  for (const sheet of baseline.sheetIdentities) {
    if (ids.has(sheet.id) || names.has(sheet.name.toLowerCase())) context.addIssue({ code: 'custom', message: 'Ambiguous baseline sheet identities.' });
    ids.add(sheet.id); names.add(sheet.name.toLowerCase());
  }
  const selected = baseline.sheetIdentities.find(sheet => sheet.id === baseline.sheet.id);
  if (selected?.name !== baseline.sheet.name) context.addIssue({ code: 'custom', message: 'Selected baseline sheet identity changed.' });
  if (JSON.stringify(referencedStyles(baseline.sheet)) !== JSON.stringify(baseline.styleDefinitions.map(entry => entry.index))) context.addIssue({ code: 'custom', message: 'Baseline style closure is incomplete or ambiguous.' });
  const positions = new Set<string>();
  for (const cell of baseline.sheet.cells) {
    const key = `${cell.row}:${cell.column}`;
    if (positions.has(key) || cell.row >= baseline.sheet.rowCount || cell.column >= baseline.sheet.columnCount) context.addIssue({ code: 'custom', message: 'Baseline cell geometry changed.' });
    positions.add(key);
  }
});
export type WorkbookSheetBaseline = z.infer<typeof workbookSheetBaselineSchema>;

/** Bound before schema cloning/canonical ordering; accept JSON-domain data only.
 * Shared references may serialize twice; cycles/accessors/exotic objects refuse. */
function bounded(value: unknown): void {
  let nodes = 0, text = 0; const ancestors = new Set<object>();
  function visit(item: unknown, depth: number) {
    if (++nodes > WORKBOOK_SHEET_BASELINE_LIMITS.nodes || depth > WORKBOOK_SHEET_BASELINE_LIMITS.depth) throw Error('Workbook baseline exceeds its node/depth limit.');
    if (typeof item === 'string') { text += item.length; }
    else if (typeof item === 'number') { if (!Number.isFinite(item)) throw Error('Workbook baseline requires finite numbers.'); }
    else if (item !== null && typeof item === 'object') {
      if (ancestors.has(item) || Object.getPrototypeOf(item) !== (Array.isArray(item) ? Array.prototype : Object.prototype) && Object.getPrototypeOf(item) !== null) throw Error('Workbook baseline requires plain acyclic JSON data.');
      if (Array.isArray(item) && item.length > WORKBOOK_SHEET_BASELINE_LIMITS.nodes - nodes) throw Error('Workbook baseline exceeds its node limit.');
      ancestors.add(item);
      if (Array.isArray(item)) {
        // Object-property traversal alone misses holes before Zod allocates one
        // parse result/error for every slot. Typed JSON arrays are dense and
        // cannot contain undefined; inspect descriptors without running getters.
        for (let index = 0; index < item.length; index++) {
          const property = Object.getOwnPropertyDescriptor(item, String(index));
          if (!property || !('value' in property) || property.value === undefined) throw Error('Workbook baseline requires dense JSON arrays.');
          visit(property.value, depth + 1);
        }
        ancestors.delete(item); return;
      }
      for (const key of Object.getOwnPropertyNames(item)) {
        const property = Object.getOwnPropertyDescriptor(item, key)!;
        if (!('value' in property)) throw Error('Workbook baseline requires own data properties.');
        text += key.length; visit(property.value, depth + 1);
      }
      ancestors.delete(item);
    } else if (item !== null && item !== undefined && typeof item !== 'boolean') throw Error('Workbook baseline requires JSON values.');
    if (text > WORKBOOK_SHEET_BASELINE_LIMITS.text) throw Error('Workbook baseline exceeds its text limit.');
  }
  visit(value, 0);
}

/** Versioned public-preview JSON semantics, not raw XML identity or lineage.
 * Reuses the existing UTF-16-key-order canonical JSON encoder. In particular,
 * absent/undefined optional object keys agree and -0 normalizes to 0, exactly as
 * the existing preview transport. Reader semantic changes require a version bump. */
export function canonicalWorkbookSheetBaseline(raw: unknown): string {
  bounded(raw);
  return encodeWorkbookJson(workbookSheetBaselineSchema.parse(raw));
}
function encodeWorkbookJson(value: unknown): string {
  const json = canonicalCommentJson(value);
  if (new TextEncoder().encode(json).byteLength > WORKBOOK_SHEET_BASELINE_LIMITS.bytes) throw Error('Workbook baseline exceeds its byte limit.');
  return json;
}
/** Same bounded JSON domain/encoder for current local continuity metadata. */
export function canonicalWorkbookJsonValue(raw: unknown): string {
  bounded(raw); return encodeWorkbookJson(raw);
}
/** Full strict model identity, including unused styles and interpretation flags. */
export function canonicalWorkbookSourceModel(raw: unknown): string {
  bounded(raw); return encodeWorkbookJson(workbookDocumentSchema.parse(raw));
}

export const WORKBOOK_SHEET_BASELINE_BATCH_LIMIT = 4096;

/** One synchronous full-source qualification, then selected data extraction.
 * The callback receives ordinary private parsed data, never an authorization or
 * durable qualification token. Selected candidates share that private read until
 * their consumer performs its aggregate byte check and context schema clone. */
export function withWorkbookSheetBaselines<T>(raw: WorkbookDocument, selectedIds: readonly string[],
  use: (model: WorkbookDocument, selected: ReadonlyMap<string, WorkbookSheetBaseline>) => T): T {
  if (!Array.isArray(selectedIds) || !selectedIds.length || selectedIds.length > WORKBOOK_SHEET_BASELINE_BATCH_LIMIT) throw Error('Workbook baseline selection exceeds its batch limit.');
  bounded(raw);
  const model = workbookDocumentSchema.parse(raw);
  const sheets = new Map(model.sheets.map(sheet => [sheet.id, sheet]));
  const identities = model.sheets.map(({ id, name }) => ({ id, name }));
  const selected = new Map<string, WorkbookSheetBaseline>();
  for (const id of new Set(selectedIds)) {
    const sheet = typeof id === 'string' ? sheets.get(id) : undefined;
    if (!sheet) throw Error('The selected workbook baseline sheet is missing.');
    selected.set(id, selectedBaselineData(model, sheet, identities));
  }
  return use(model, selected);
}

/** Existing single-capture API retains its detached schema-canonicalized data. */
export function workbookSheetBaseline(raw: WorkbookDocument, selectedId: string): WorkbookSheetBaseline {
  return withWorkbookSheetBaselines(raw, [selectedId], (_model, selected) => workbookSheetBaselineSchema.parse(selected.get(selectedId)));
}

function selectedBaselineData(model: WorkbookDocument, sheet: WorkbookSheetBaseline['sheet'],
  sheetIdentities: WorkbookSheetBaseline['sheetIdentities']): WorkbookSheetBaseline {
  return {
    kind: 'evebot-workbook-selected-sheet', version: WORKBOOK_SHEET_BASELINE_VERSION,
    date1904: model.date1904, themeColors: model.themeColors,
    calculationMetadata: model.calculationMetadata, richTextMetadata: model.richTextMetadata,
    worksheetStructureEditable: model.worksheetStructureEditable, worksheetVisibilityEditable: model.worksheetVisibilityEditable,
    features: model.features, sheetIdentities, definedNames: model.definedNames, tables: model.tables,
    sheet, styleDefinitions: referencedStyles(sheet).map(index => {
      const style = model.styles[index]; if (!style) throw Error('Referenced workbook baseline style is missing.');
      return { index, style };
    }),
  };
}
