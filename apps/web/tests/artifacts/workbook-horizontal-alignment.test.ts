import { decodeWorkbookDraft, encodeWorkbookDraft } from '../../src/components/embedded/workbook/workbook-checkpoint';
import { workbookAlignmentDataProjection } from '../../src/components/embedded/workbook/grid-horizontal-alignment';
import { IDBFactory } from 'fake-indexeddb';
import { readWorkbookDraft, saveWorkbookDraft, serializeWorkbookDraft } from '../../src/components/embedded/workbook/draft-store';
import { legacyWorkbookWrite } from '../fixtures/workbook-write-result';
import { WorkbookWriter, type WorkbookWriteIntent } from '../../src/components/embedded/workbook/workbook-writer';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import type { WorkbookDocument, WorkbookStyle } from '@open-design/contracts/runtime/workbook';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { workbookGridEdits } from '../../src/components/embedded/workbook/grid-edits';
import { workbookAlignmentProvenance } from '../../src/components/embedded/workbook/grid-horizontal-alignment';
import { workbookFormattingBridge } from '../../src/components/embedded/workbook/grid-format';
const require = createRequire(realpathSync(fileURLToPath(new URL('../../node_modules/@univerjs/preset-sheets-core/package.json', import.meta.url))));
const core = require('@univerjs/core') as typeof import('@univerjs/presets');
const { FUniver } = require('@univerjs/core/facade') as typeof import('@univerjs/presets');
const sheets = require('@univerjs/sheets') as typeof import('@univerjs/preset-sheets-core');
require('@univerjs/sheets/facade');
const closers: (() => void)[] = [];
afterEach(() => { closers.splice(0).reverse().forEach(close => close()); vi.unstubAllGlobals(); });
function fixture(mixed = false, rich = false, inherited = false, horizontal: NonNullable<WorkbookStyle['alignment']>['horizontal'] = 'left', configure?: (model: WorkbookDocument) => void, rowPriority = false, unitId = 'alignment-test', defaultTextColor?: string) {
  const English = require('@univerjs/preset-sheets-core/locales/en-US');
  const univer = new core.Univer({ locale: core.LocaleType.EN_US, locales: { [core.LocaleType.EN_US]: English.default ?? English } });
  closers.push(() => univer.dispose()); univer.registerPlugin(sheets.UniverSheetsPlugin);
  const api = FUniver.newAPI(univer);
  const model: WorkbookDocument = {
    version: 1, date1904: false, activeSheetId: 's',
    styles: [{ font: { name: 'Calibri', size: 11 }, numberFormat: '0.00', alignment: { horizontal, vertical: 'middle', wrap: true, shrink: true, rotation: 15 } }, { alignment: { horizontal: 'right' } }, { font: { italic: true } }],
    features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false },
    sheets: [{ id: 's', name: 'Sheet', visibility: 'visible', rowCount: 100, columnCount: 26,
      cells: [{ row: 1, column: 1, kind: 'number', value: 10000 }, { row: 1, column: 2, kind: 'string', value: 'Text', ...(mixed ? { style: 1 } : {}) }],
      merges: [], rowDimensions: inherited ? [{ index: 1, style: 2 }] : [], columnDimensions: [], frozenRows: 0, frozenColumns: 0 }],
  };
  configure?.(model);
  const prepared = gridWorkbook(model, unitId, 'Alignment', defaultTextColor).data;
  const book = api.createWorkbook(prepared);
  // Rendered SheetSkeleton defaults to column precedence; Node has no skeleton.
  book.getActiveSheet().getSheet().setIsRowStylePrecedeColumnStyle(rowPriority);
  const origins = workbookAlignmentProvenance(book, model, prepared.styles ?? {}, () => true, true, rowPriority);
  closers.push(() => origins.dispose());
  const sheet = book.getActiveSheet(); book.setEditable(true);
  sheet.setActiveRange(sheet.getRange(1, 1, 1, 1));
  univer.__getInjector().get(core.IUniverInstanceService).focusUnit(book.getId());
  if (rich) sheet.getRange(1, 3).setValue({ p: { id: 'rich-guard', documentStyle: {}, body: { dataStream: 'Rich\r\n', textRuns: [{ st: 0, ed: 4, ts: { bl: 1 } }] } } });
  const initial = book.save();
  const postMessage = vi.fn(), parent = { postMessage }, handlers = new Set<(event: MessageEvent) => void>();
  vi.stubGlobal('window', { parent, location: { origin: 'http://fixture.invalid' }, addEventListener: (_: string, fn: (event: MessageEvent) => void) => handlers.add(fn), removeEventListener: (_: string, fn: (event: MessageEvent) => void) => handlers.delete(fn) });
  const scope = { projectId: '11111111-1111-4111-8111-111111111111', controllerId: '22222222-2222-4222-8222-222222222222', blocked: false, saving: false };
  const bridge = workbookFormattingBridge(api, () => scope, origins); closers.push(bridge.dispose);
  const message = (value: unknown, selectionKey = 's:1:1:1:1', overrides = {}) => handlers.forEach(fn => fn({ source: parent, origin: 'http://fixture.invalid', data: { type: 'studio:workbook-format', projectId: scope.projectId, controllerId: scope.controllerId, selectionKey, action: { property: 'horizontalAlignment', value } }, ...overrides } as unknown as MessageEvent));
  const state = () => postMessage.mock.lastCall?.[0];
  const plan = () => workbookGridEdits(model, 'a'.repeat(64), initial, book.save(), origins);
  return { api, book, sheet, model, initial, origins, bridge, scope, handlers, parent, message, state, plan };
}
it.each(['left', 'center', 'right', 'general'] as const)('uses native %s commands and sparse style preservation through Undo/Redo', async value => {
  const f = fixture();
  expect(f.state()).toMatchObject({ horizontalAlignment: 'left' });
  f.message(value);
  expect(f.sheet.getRange(1, 1).getCellStyleData()?.ht).toBe({ left: core.HorizontalAlign.LEFT, center: core.HorizontalAlign.CENTER, right: core.HorizontalAlign.RIGHT, general: core.HorizontalAlign.UNSPECIFIED }[value]);
  expect(f.sheet.getSheet().getComposedCellStyle(1, 1)).toMatchObject({ vt: core.VerticalAlign.MIDDLE, tb: core.WrapStrategy.WRAP, stf: core.BooleanNumber.TRUE, tr: { a: 15 }, n: { pattern: '0.00' } });
  expect(f.plan().edits).toEqual([]);
  expect(f.plan().styles).toEqual(value === 'left' ? undefined : [{ sheetId: 's', row: 1, column: 1, horizontalAlignment: value }]);
  if (value !== 'left') {
    await f.api.undo(); expect(f.plan().styles).toBeUndefined();
    await f.api.redo(); expect(f.plan().styles?.[0]).toMatchObject({ horizontalAlignment: value });
  }
  expect(f.model.styles[0]?.alignment).toEqual({ horizontal: 'left', vertical: 'middle', wrap: true, shrink: true, rotation: 15 });
});
it('reports mixed ranges, blank inherited cells and unsupported native alignments accurately', () => {
  const f = fixture(true);
  f.sheet.setActiveRange(f.sheet.getRange(1, 1, 1, 2)); f.bridge.publish();
  expect(f.state()).toMatchObject({ selected: true, horizontalAlignment: null });
  f.message('center', 's:1:1:1:2'); expect(f.state()).toMatchObject({ horizontalAlignment: 'center' });
  f.sheet.setActiveRange(f.sheet.getRange(2, 1, 1, 2)); f.bridge.publish();
  expect(f.state()).toMatchObject({ horizontalAlignment: 'left' });
  f.api.syncExecuteCommand(sheets.SetHorizontalTextAlignCommand.id, { unitId: f.book.getId(), subUnitId: 's', range: f.sheet.getRange(2, 1).getRange(), value: core.HorizontalAlign.JUSTIFIED });
  f.bridge.publish(); expect(f.state()).toMatchObject({ horizontalAlignment: null });
  expect(f.plan().styles).toContainEqual({ sheetId: 's', row: 2, column: 1, horizontalAlignment: 'justify' });
});
it('refuses unsupported style changes instead of saving them beside alignment', () => {
  const f = fixture(); f.message('center');
  f.sheet.getRange(1, 1).setWrapStrategy(core.WrapStrategy.CLIP);
  expect(f.plan).toThrow('formatting change');
});
it('guards a later rich cell even after detecting mixed alignment earlier in the range', () => {
  const f = fixture(true, true);
  f.sheet.setActiveRange(f.sheet.getRange(1, 1, 1, 3)); f.bridge.publish();
  const before = f.book.save(); expect(f.state()).toMatchObject({ selected: false });
  f.message('right', 's:1:1:1:3'); expect(f.book.save()).toEqual(before);
});
it('rejects saving, stale selection, foreign origin, readonly, malformed and retired-owner requests', () => {
  const f = fixture(); const before = f.book.save();
  f.scope.saving = true; f.message('center'); f.scope.saving = false;
  f.message('center', 'stale'); f.message('center', undefined, { origin: 'http://other.invalid' });
  f.message('center', undefined, { source: {} });
  for (const value of [null, 'justify', 'normal', 0, {}, undefined]) f.message(value);
  f.scope.blocked = true; f.message('right'); f.scope.blocked = false;
  f.book.setEditable(false); f.message('right'); f.book.setEditable(true);
  expect(f.book.save()).toEqual(before);
  const retired = [...f.handlers][0]!; f.bridge.dispose();
  retired({ source: f.parent, origin: 'http://fixture.invalid', data: { type: 'studio:workbook-format', projectId: f.scope.projectId, controllerId: f.scope.controllerId, selectionKey: 's:1:1:1:1', action: { property: 'horizontalAlignment', value: 'right' } } } as unknown as MessageEvent);
  expect(f.book.save()).toEqual(before);
});
it('derives the sparse edit from the actual native alignment command', () => {
  const f = fixture();
  f.api.syncExecuteCommand(sheets.SetHorizontalTextAlignCommand.id, { unitId: f.book.getId(), subUnitId: 's', range: f.sheet.getRange(1, 1).getRange(), value: core.HorizontalAlign.CENTER });
  expect(f.plan().styles).toEqual([{ sheetId: 's', row: 1, column: 1, horizontalAlignment: 'center' }]);
});

it('keeps the existing 100,000-cell limit, including blank inherited alignment', () => {
  const f = fixture();
  // Actual SDK geometry changes are only a selection-bound fixture here; they
  // are not fed into the source-preserving edit plan.
  f.sheet.setRowCount(1001); f.sheet.setColumnCount(100);
  f.sheet.setActiveRange(f.sheet.getRange(0, 0, 1000, 100)); f.bridge.publish();
  expect(f.state()).toMatchObject({ selected: true, horizontalAlignment: 'left' });
  f.sheet.setActiveRange(f.sheet.getRange(0, 0, 1001, 100)); f.bridge.publish();
  expect(f.state()).toMatchObject({ selected: false, horizontalAlignment: null });
});
it('never accepts another controller or project as the formatting owner', () => {
  const f = fixture(); const before = f.book.save();
  const request = { type: 'studio:workbook-format', projectId: f.scope.projectId, controllerId: f.scope.controllerId, selectionKey: 's:1:1:1:1', action: { property: 'horizontalAlignment', value: 'center' } };
  for (const patch of [{ projectId: '33333333-3333-4333-8333-333333333333' }, { controllerId: '33333333-3333-4333-8333-333333333333' }]) f.message('center', undefined, { data: { ...request, ...patch } });
  expect(f.book.save()).toEqual(before);
});

it('keeps a General reset when a partial row style inherits the default left alignment', () => {
  const f = fixture(false, false, true);
  expect(f.state()).toMatchObject({ horizontalAlignment: 'left' });
  f.message('general');
  expect(f.sheet.getRange(1, 1).getCellStyleData()?.ht).toBe(core.HorizontalAlign.UNSPECIFIED);
  expect(f.plan().styles).toEqual([{ sheetId: 's', row: 1, column: 1, horizontalAlignment: 'general' }]);
});

it('leaves the native Redo branch and snapshot intact for an already uniform choice', async () => {
  const f = fixture(); f.message('center'); await f.api.undo();
  const before = f.book.save(); f.message('left');
  expect(f.book.save()).toEqual(before);
  await f.api.redo(); expect(f.state()).toBeDefined();
  expect(f.sheet.getRange(1, 1).getCellStyleData()?.ht).toBe(core.HorizontalAlign.CENTER);
});

it.each(['fill', 'centerContinuous'] as const)('does not present source %s as General or skip its automatic reset', horizontal => {
  const f = fixture(false, false, false, horizontal);
  expect(f.state()).toMatchObject({ horizontalAlignment: null });
  f.message('general');
  expect(f.sheet.getRange(1, 1).getCellStyleData()?.ht).toBe(core.HorizontalAlign.UNSPECIFIED);
  expect(f.plan().styles).toEqual([{ sheetId: 's', row: 1, column: 1, horizontalAlignment: 'general' }]);
});

it.each([false, true])('matches actual configured row/column overlap (rowPriority=%s) in state and planning', rowPriority => {
  const f = fixture(false, false, false, 'general', model => {
    model.styles.push({ alignment: { horizontal: 'center' } });
    model.sheets[0]!.rowDimensions = [{ index: 1, style: 1 }];
    model.sheets[0]!.columnDimensions = [{ index: 1, style: 3 }];
  }, rowPriority);
  const expected = rowPriority ? 'right' : 'center';
  expect(f.sheet.getSheet().getComposedCellStyle(1, 1).ht).toBe(rowPriority ? core.HorizontalAlign.RIGHT : core.HorizontalAlign.CENTER);
  expect(f.state().horizontalAlignment).toBe(expected);
  expect(f.origins.snapshot(f.book.save())('s', 1, 1)).toBe(expected);
  f.message('general');
  expect(f.plan().styles).toEqual([{ sheetId: 's', row: 1, column: 1, horizontalAlignment: 'general' }]);
});
it('does not reinterpret retained SDK style IDs using re-compacted ACK model ordinals', async () => {
  const f = fixture(false, false, false, 'fill');
  const old = f.book.save();
  f.message('general');
  const acknowledged = f.book.save();
  // A fresh reader can reorder style ordinals while the live kernel does not.
  f.model.styles.reverse();
  expect(f.origins.snapshot(old)('s', 1, 1)).toBe('fill');
  expect(f.origins.snapshot(acknowledged)('s', 1, 1)).toBe('general');
  await f.api.undo();
  const undone = f.book.save();
  expect(workbookGridEdits(f.model, 'a'.repeat(64), acknowledged, undone, f.origins).styles).toEqual([{ sheetId: 's', row: 1, column: 1, horizontalAlignment: 'fill' }]);
});
it('withdraws provenance when the exact source style object is mutated or kernel retired', () => {
  const f = fixture(false, false, false, 'fill');
  const style = f.book.getWorkbook().getStyles().get('0')!;
  style.fs = 29;
  expect(f.origins.snapshot(f.book.save())('s', 1, 1)).toBeNull();
  f.origins.dispose();
  expect(f.origins.snapshot(f.initial)('s', 1, 1)).toBeNull();
});

it.each(['fill', 'centerContinuous'] as const)('retains private %s provenance through actual SDK history and Writer acknowledgements', async original => {
  const f = fixture(false, false, false, original);
  const source = { sourceSha256: 'a'.repeat(64), model: structuredClone(f.model) };
  const intents: WorkbookWriteIntent[] = [];
  const writer = new WorkbookWriter(source, f.initial, async intent => {
    intents.push(structuredClone(intent));
    const model = structuredClone(f.model);
    // Reader ordinals are not the retained live SDK style IDs.
    model.styles.reverse();
    return legacyWorkbookWrite({ sourceSha256: String(intents.length).repeat(64), model });
  }, () => {}, undefined, undefined, f.origins);
  try {
    f.message('general'); writer.update(f.book.save()); await writer.flush();
    expect(writer.state()).toEqual({ dirty: false, saving: false, error: null });
    await f.api.undo(); writer.update(f.book.save()); await writer.flush();
    expect(writer.state()).toEqual({ dirty: false, saving: false, error: null });
    await f.api.redo(); writer.update(f.book.save()); await writer.flush();
    expect(intents.map(intent => intent.plan.styles?.[0]?.horizontalAlignment)).toEqual(['general', original, 'general']);
    expect(intents.map(intent => intent.plan.sourceSha256)).toEqual(['a'.repeat(64), '1'.repeat(64), '2'.repeat(64)]);
    expect(writer.state()).toEqual({ dirty: false, saving: false, error: null });
  } finally { await writer.close(); }
});
it('retains an unprovable alignment-removal draft and refuses its save', async () => {
  const f = fixture(false, false, false, 'fill');
  f.message('general');
  const acknowledged = f.book.save(), source = { sourceSha256: 'b'.repeat(64), model: f.model };
  await f.api.undo();
  const write = vi.fn();
  const writer = new WorkbookWriter(source, acknowledged, write, () => {});
  try {
    writer.update(f.book.save()); await writer.flush();
    expect(writer.state()).toMatchObject({ dirty: true, error: expect.stringContaining('horizontal alignment') });
    expect(writer.checkpoint().desired).toEqual(f.book.save()); expect(write).not.toHaveBeenCalled();
  } finally { await writer.close(); }
});
it('follows raw source style IDs through actual row insertion rather than original coordinates', () => {
  const f = fixture(false, false, false, 'left', model => {
    model.styles.push({ alignment: { horizontal: 'fill' } });
    model.sheets[0]!.cells[0]!.style = 3;
  });
  expect(f.origins.snapshot(f.book.save())('s', 1, 1)).toBe('fill');
  f.sheet.insertRowsBefore(1, 1);
  f.sheet.setActiveRange(f.sheet.getRange(2, 1)); f.bridge.publish();
  expect(f.state().horizontalAlignment).toBeNull();
  expect(f.origins.snapshot(f.book.save())('s', 2, 1)).toBe('fill');
  f.message('general', 's:2:1:2:1');
  expect(f.origins.snapshot(f.book.save())('s', 2, 1)).toBe('general');
});
it('keeps native Redo when Automatic is already proven, but resets an unrepresented origin', async () => {
  const f = fixture(false, false, false, 'general');
  f.message('right'); await f.api.undo(); f.bridge.publish();
  expect(f.state().horizontalAlignment).toBe('general');
  f.message('general'); await f.api.redo();
  expect(f.origins.snapshot(f.book.save())('s', 1, 1)).toBe('right');
});

it.each(['fill', 'centerContinuous'] as const)('protects actual native %s Undo after General acknowledgement through the real draft journal', async original => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const scope = { viewerId: 'alignment-viewer', projectId: '11111111-1111-4111-8111-111111111111', fileName: 'Alignment.xlsx', draftId: crypto.randomUUID() };
  const f = fixture(false, false, false, original, undefined, false, `${scope.projectId}:${scope.fileName}`, 'rgb(245, 245, 245)');
  const intents: WorkbookWriteIntent[] = [];
  const source = { sourceSha256: 'a'.repeat(64), model: structuredClone(f.model) };
  const journal = { scope, validate: (checkpoint: Parameters<typeof serializeWorkbookDraft>[1]) => { serializeWorkbookDraft(scope, checkpoint); }, save: (checkpoint: Parameters<typeof saveWorkbookDraft>[1]) => saveWorkbookDraft(scope, checkpoint) };
  const writer = new WorkbookWriter(source, f.initial, async intent => {
    intents.push(structuredClone(intent));
    const model = structuredClone(f.model);
    model.styles[0]!.alignment!.horizontal = intent.plan.styles![0]!.horizontalAlignment;
    return legacyWorkbookWrite({ sourceSha256: String(intents.length).repeat(64), model });
  }, () => {}, undefined, journal, f.origins);
  try {
    f.message('general'); writer.update(f.book.save()); await writer.flush();
    expect(writer.state()).toEqual({ dirty: false, saving: false, error: null });
    await f.api.undo(); writer.update(f.book.save()); await writer.flush();
    expect(writer.state()).toEqual({ dirty: false, saving: false, error: null });
    expect(intents.map(intent => intent.plan.styles?.[0]?.horizontalAlignment)).toEqual(['general', original]);
    await f.api.redo(); writer.update(f.book.save()); await writer.flush();
    expect(intents.map(intent => intent.plan.styles?.[0]?.horizontalAlignment)).toEqual(['general', original, 'general']);
    expect(await readWorkbookDraft(scope)).toBeNull();
  } finally { await writer.close(); }
});

it('keeps pending alignment intent exact through IDB/recovery and rejects mismatched representation data', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const scope = { viewerId: 'alignment-viewer', projectId: '11111111-1111-4111-8111-111111111111', fileName: 'Alignment.xlsx', draftId: crypto.randomUUID() };
  const f = fixture(false, false, false, 'fill', undefined, false, `${scope.projectId}:${scope.fileName}`);
  const source = { sourceSha256: 'a'.repeat(64), model: f.model };
  const journal = { scope, save: (checkpoint: Parameters<typeof saveWorkbookDraft>[1]) => saveWorkbookDraft(scope, checkpoint) };
  const transport = vi.fn(async (_intent: WorkbookWriteIntent) => {
    if (transport.mock.calls.length > 1) throw Error('Response lost');
    const model = structuredClone(f.model); model.styles[0]!.alignment!.horizontal = 'general';
    return legacyWorkbookWrite({ sourceSha256: 'b'.repeat(64), model });
  });
  const writer = new WorkbookWriter(source, f.initial, transport, () => {}, undefined, journal, f.origins);
  try {
    f.message('general'); writer.update(f.book.save()); await writer.flush();
    await f.api.undo(); writer.update(f.book.save()); await writer.flush();
    expect(transport).toHaveBeenCalledTimes(2);
    const pending = (await readWorkbookDraft(scope))!;
    expect(pending.pending?.intent.plan.styles?.[0]?.horizontalAlignment).toBe('fill');
    expect(decodeWorkbookDraft(encodeWorkbookDraft(scope, pending), scope)).toEqual(pending);
    const malformed: Array<(checkpoint: typeof pending) => void> = [
      checkpoint => { checkpoint.alignmentData!.unitId = 'foreign'; },
      checkpoint => { Object.assign(checkpoint.alignmentData!, { version: 2 }); },
      checkpoint => { Object.assign(checkpoint.alignmentData!.styles[0]!, { horizontal: 'diagonal' }); },
      checkpoint => { checkpoint.desired.styles['0']!.fs = 99; },
      checkpoint => { checkpoint.alignmentData!.styles[0]!.id = '19999'; },
      checkpoint => { checkpoint.alignmentData!.styles.push(structuredClone(checkpoint.alignmentData!.styles[0]!)); },
      checkpoint => { checkpoint.alignmentData!.styles[0]!.definition.fs = 99; },
      checkpoint => { checkpoint.alignmentData!.styles[0]!.horizontal = 'centerContinuous'; },
      checkpoint => { delete checkpoint.alignmentData; },
      checkpoint => { checkpoint.pending!.intent.plan.styles![0]!.horizontalAlignment = 'centerContinuous'; },
    ];
    for (const mutate of malformed) {
      const changed = structuredClone(pending); mutate(changed);
      expect(() => serializeWorkbookDraft(scope, changed)).toThrow();
      await expect(saveWorkbookDraft(scope, changed)).rejects.toThrow();
      expect(await readWorkbookDraft(scope)).toEqual(pending);
    }
    // Valid presentation data does not implement a live bridge or native issuer.
    expect(workbookAlignmentDataProjection(pending.alignmentData!)).not.toHaveProperty('live');
    await writer.close();
    const retried = vi.fn(async (_intent: WorkbookWriteIntent) => { throw Error('Still unavailable'); });
    const recovered = new WorkbookWriter(pending.source, pending.acknowledged, retried, () => {}, undefined, { ...journal, restored: pending });
    try {
      await recovered.flush();
      expect(retried).toHaveBeenCalledOnce();
      expect(retried.mock.calls[0]![0]).toEqual(pending.pending!.intent);
    } finally { await recovered.close(); }
  } finally { await writer.close(); }
});

it('does not replace a retired live registry with stored presentation data to admit a new save', async () => {
  const f = fixture(false, false, false, 'fill');
  const source = { sourceSha256: 'a'.repeat(64), model: f.model };
  const transport = vi.fn(async (_intent: WorkbookWriteIntent) => legacyWorkbookWrite({ ...source, sourceSha256: 'b'.repeat(64) }));
  const writer = new WorkbookWriter(source, f.initial, transport, () => {}, undefined, undefined, f.origins);
  try {
    f.message('general'); writer.update(f.book.save()); await writer.flush();
    await f.api.undo(); f.origins.dispose(); writer.update(f.book.save()); await writer.flush();
    expect(transport).toHaveBeenCalledOnce();
    expect(writer.state()).toMatchObject({ dirty: true, error: expect.stringContaining('horizontal alignment') });
    expect(writer.checkpoint().desired).toEqual(f.book.save());
  } finally { await writer.close(); }
});
