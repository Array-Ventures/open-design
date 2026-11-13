import { afterEach, expect, it, vi } from 'vitest';
import {
  BaselineOffset,
  ICommandService,
  IUniverInstanceService,
  LocaleType,
  TextDecoration,
  Univer,
  type IWorkbookData,
} from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import English from '@univerjs/sheets/locale/en-US';
import '@univerjs/sheets/facade';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import * as gridModel from '../../src/components/embedded/workbook/grid-model';
import { gridWorkbook, workbookGridRunFont } from '../../src/components/embedded/workbook/grid-model';
import { workbookGridEdits } from '../../src/components/embedded/workbook/grid-edits';
const sha = 'a'.repeat(64);
function model(): WorkbookDocument {
  return {
    version: 1,
    richTextMetadata: 'verified',
    calculationMetadata: 'verified',
    date1904: false,
    activeSheetId: 's',
    styles: [{}],
    features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false },
    sheets: [
      {
        id: 's',
        name: 'Rich',
        visibility: 'visible',
        rowCount: 100,
        columnCount: 26,
        rowDimensions: [],
        columnDimensions: [],
        frozenRows: 0,
        frozenColumns: 0,
        merges: [],
        arrayFormulas: [],
        cells: [{ row: 0, column: 0, kind: 'string', value: 'old' }],
      },
    ],
  };
}
let cleanup = () => {};
afterEach(() => cleanup());
it('uses the genuine public rich-value command and undo path without flattening fonts or text', () => {
  const source = model(),
    univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: English } });
  cleanup = () => univer.dispose();
  univer.registerPlugin(UniverFormulaEnginePlugin, { notExecuteFormula: true });
  univer.registerPlugin(UniverSheetsPlugin, { notExecuteFormula: true });
  const api = FUniver.newAPI(univer),
    book = api.createWorkbook(gridWorkbook(source, 'unit', 'Rich').data as IWorkbookData),
    sheet = book.getActiveSheet();
  const initial = structuredClone(book.save());
  const units = univer.__getInjector().get(IUniverInstanceService);
  units.setCurrentUnitForType('unit');
  units.focusUnit('unit');
  const rich = api
    .newRichText()
    .span('  A😀 ', {
      ff: 'Noto Serif',
      fs: 14,
      bl: 0,
      it: 1,
      st: { s: 1 },
      ul: { s: 1, t: TextDecoration.DOUBLE_ACCOUNTING },
      va: BaselineOffset.SUPERSCRIPT,
      cl: { rgb: '#11223380' },
    })
    .span('終\t ', { bl: 1, cl: { rgb: '#abcdef' } });
  sheet.getRange(0, 0).setRichTextValueForCell(rich);
  const current = book.save(),
    plan = workbookGridEdits(source, sha, initial, current);
  expect(plan.edits).toEqual([
    {
      sheetId: 's',
      cell: {
        row: 0,
        column: 0,
        kind: 'string',
        value: '  A😀 終\t ',
        runs: [
          {
            text: '  A😀 ',
            font: {
              name: 'Noto Serif',
              size: 14,
              bold: false,
              italic: true,
              strike: true,
              underline: 'doubleAccounting',
              vertical: 'superscript',
              color: { kind: 'rgb', argb: '80112233' },
            },
          },
          { text: '終\t ', font: { bold: true, color: { kind: 'rgb', argb: 'FFABCDEF' } } },
        ],
      },
    },
  ]);
  const commands = univer.__getInjector().get(ICommandService);
  expect(commands.syncExecuteCommand('univer.command.undo')).toBe(true);
  expect(workbookGridEdits(source, sha, initial, book.save()).edits).toEqual([]);
  expect(commands.syncExecuteCommand('univer.command.redo')).toBe(true);
  expect(workbookGridEdits(source, sha, initial, book.save())).toEqual(plan);
  expect(initial.sheets.s!.cellData![0]![0]!.v).toBe('old');
});
it('retains exact theme/indexed/auto colors and authored font family metadata through text and run formatting edits', () => {
  const source = model(),
    runs = [
      { text: 'old ', font: { name: 'Calibri', family: 2, color: { kind: 'theme' as const, index: 4, tint: 0.2 } } },
      { text: 'text', font: { name: 'Consolas', family: 3, color: { kind: 'indexed' as const, index: 5 } } },
    ];
  source.sheets[0]!.cells[0] = { row: 0, column: 0, kind: 'string', value: 'old text', runs };
  const initial = gridWorkbook(source, 'unit', 'Rich').data as IWorkbookData,
    current = structuredClone(initial),
    body = current.sheets.s!.cellData![0]![0]!.p!.body!;
  body.dataStream = 'new text\r\n';
  body.textRuns![0]!.ts!.bl = 1;
  const plan = workbookGridEdits(source, sha, initial, current);
  expect(plan.edits[0]!.cell).toMatchObject({
    value: 'new text',
    runs: [
      { text: 'new ', font: { ...runs[0]!.font, bold: true } },
      { text: 'text', font: runs[1]!.font },
    ],
  });
  const colors = source.sheets[0]!.cells[0];
  if (colors.kind === 'string') colors.runs![0]!.font!.color = { kind: 'auto' };
  expect(
    workbookGridRunFont(colors.kind === 'string' ? colors.runs![0]!.font : undefined, source, new Set()).cl,
  ).toBeUndefined();
});
it.each([
  (p: import('@univerjs/core').IDocumentData) => {
    p.body!.textRuns = [
      { st: 0, ed: 2, ts: { bl: 1 } },
      { st: 1, ed: 3, ts: { it: 1 } },
    ];
  },
  (p: import('@univerjs/core').IDocumentData) => {
    p.body!.textRuns = [{ st: 0, ed: 3, ts: { bg: { rgb: '#112233' } } }];
  },
  (p: import('@univerjs/core').IDocumentData) => {
    p.body!.customRanges = [{ startIndex: 0, endIndex: 1, rangeId: 'link', rangeType: 0 }];
  },
  (p: import('@univerjs/core').IDocumentData) => {
    p.body!.dataStream = 'A😀\r\n';
    p.body!.textRuns = [
      { st: 0, ed: 2, ts: { bl: 1 } },
      { st: 2, ed: 3 },
    ];
    p.body!.paragraphs = [{ startIndex: 3, paragraphId: 'p' }];
  },
])('refuses malformed or unsupported rich input instead of flattening a partial save', (change) => {
  const source = model(),
    initial = gridWorkbook(source, 'unit', 'Rich').data as IWorkbookData,
    current = structuredClone(initial);
  current.sheets.s!.cellData![0]![0]!.p = {
    id: 'rich',
    documentStyle: {},
    body: {
      dataStream: 'old\r\n',
      textRuns: [{ st: 0, ed: 3, ts: { bl: 1 } }],
      paragraphs: [{ startIndex: 3, paragraphId: 'p' }],
    },
  };
  change(current.sheets.s!.cellData![0]![0]!.p!);
  expect(() => workbookGridEdits(source, sha, initial, current)).toThrow();
});

it('keeps older rich preview drafts intact and refuses promoting their projected fonts into authored edits', () => {
  const source = model();
  delete source.richTextMetadata;
  source.sheets[0]!.cells[0] = {
    row: 0,
    column: 0,
    kind: 'string',
    value: 'old',
    runs: [{ text: 'old', font: { bold: true } }],
  };
  const initial = gridWorkbook(source, 'unit', 'Rich').data as IWorkbookData,
    current = structuredClone(initial);
  current.sheets.s!.cellData![0]![0]!.p!.body!.textRuns![0]!.ts!.it = 1;
  const protectedDraft = structuredClone(current);
  expect(() => workbookGridEdits(source, sha, initial, current)).toThrow('older source preview');
  expect(current).toEqual(protectedDraft);
});

it('indexes source font metadata once for a densely segmented text edit', () => {
  const source = model(),
    font = { name: 'Calibri', family: 2, color: { kind: 'theme' as const, index: 4 } },
    runs = Array.from({ length: 1000 }, () => ({ text: 'a', font }));
  source.sheets[0]!.cells[0] = { row: 0, column: 0, kind: 'string', value: 'a'.repeat(1000), runs };
  const initial = gridWorkbook(source, 'unit', 'Rich').data as IWorkbookData,
    current = structuredClone(initial),
    body = current.sheets.s!.cellData![0]![0]!.p!.body!,
    style = workbookGridRunFont(font, source, new Set());
  body.dataStream = `${'a'.repeat(1001)}\r\n`;
  body.textRuns = Array.from({ length: 1001 }, (_, index) => ({ st: index, ed: index + 1, ts: style }));
  body.paragraphs = [{ startIndex: 1001, paragraphId: 'p' }];
  const projection = vi.spyOn(gridModel, 'workbookGridRunFont');
  try {
    const plan = workbookGridEdits(source, sha, initial, current);
    expect(plan.edits[0]!.cell).toMatchObject({ value: 'a'.repeat(1001) });
    expect(projection.mock.calls.length).toBeLessThanOrEqual(3000);
  } finally {
    projection.mockRestore();
  }
});
it('does not author fallback lists or RGB spelling changes as source font changes', () => {
  const source = model();
  source.themeColors = Array.from({ length: 12 }, () => 'FF112233');
  source.sheets[0]!.cells[0] = {
    row: 0,
    column: 0,
    kind: 'string',
    value: 'old',
    runs: [{ text: 'old', font: { name: 'Calibri', family: 2, color: { kind: 'theme', index: 4, tint: 0.2 } } }],
  };
  const initial = gridWorkbook(source, 'unit', 'Rich').data as IWorkbookData,
    current = structuredClone(initial),
    run = current.sheets.s!.cellData![0]![0]!.p!.body!.textRuns![0]!;
  run.ts = { ff: 'Calibri', cl: { rgb: 'rgb(17, 34, 51)' }, it: 1 };
  expect(workbookGridEdits(source, sha, initial, current).edits[0]!.cell).toMatchObject({
    runs: [
      {
        text: 'old',
        font: { name: 'Calibri', family: 2, color: { kind: 'theme', index: 4, tint: 0.2 }, italic: true },
      },
    ],
  });
});
it('represents native underline-off and normal baseline explicitly instead of inheriting cell fonts', () => {
  const source = model();
  source.styles[0] = { font: { underline: 'double', vertical: 'superscript' } };
  source.sheets[0]!.cells[0] = { row: 0, column: 0, kind: 'string', value: 'old', runs: [{ text: 'old' }] };
  const initial = gridWorkbook(source, 'unit', 'Rich').data as IWorkbookData,
    current = structuredClone(initial);
  current.sheets.s!.cellData![0]![0]!.p!.body!.textRuns![0]!.ts = { ul: { s: 0 }, va: BaselineOffset.NORMAL };
  expect(workbookGridEdits(source, sha, initial, current).edits[0]!.cell).toMatchObject({
    runs: [{ text: 'old', font: { underline: 'none', vertical: 'baseline' } }],
  });
  expect(workbookGridRunFont({ underline: 'none', vertical: 'baseline' }, source, new Set())).toMatchObject({
    ul: { s: 0, t: TextDecoration.NONE },
    va: BaselineOffset.NORMAL,
  });
});

it('refuses a formula and newly authored rich document sharing one cell instead of silently dropping the rich edit', () => {
  const source = model();
  source.sheets[0]!.cells[0] = { row: 0, column: 0, kind: 'number', value: 2, formula: '=1+1' };
  const initial = gridWorkbook(source, 'unit', 'Rich').data as IWorkbookData,
    current = structuredClone(initial);
  current.sheets.s!.cellData![0]![0]!.p = {
    id: 'new',
    documentStyle: {},
    body: {
      dataStream: 'rich\r\n',
      paragraphs: [{ startIndex: 4, paragraphId: 'p' }],
      textRuns: [{ st: 0, ed: 4, ts: { bl: 1 } }],
    },
  };
  expect(() => workbookGridEdits(source, sha, initial, current)).toThrow('Replace the formula');
});
