import { expect, it } from 'vitest';
import ExcelJS from 'exceljs-community';
import { workbookCellSchema } from '@open-design/contracts/runtime/workbook';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { calculateWorkbookCellEdits } from '../../src/artifacts/workbook/calculated-patch.js';
import { patchWorkbookCells } from '../../src/artifacts/workbook/cell-patch.js';
async function fixture() {
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet('Rich');
  const rich = {
    richText: [
      { text: 'old ', font: { bold: true } },
      { text: 'text', font: { italic: true } },
    ],
  };
  sheet.getCell('A1').value = rich;
  sheet.getCell('B1').value = rich;
  sheet.getCell('C1').value = { formula: '1+1', result: 2 };
  sheet.getCell('A1').numFmt = '@';
  return readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer({ useSharedStrings: true })));
}
it('writes real rich runs inline without changing shared aliases, styles or unrelated source parts', async () => {
  const source = await fixture(),
    before = new Map(source.parts),
    original = source.model.sheets[0]!.cells.find((cell) => cell.column === 0)!;
  const runs = [
    {
      text: '  α😀 _x0041_\r\n',
      font: {
        name: 'Noto Serif',
        family: 1,
        size: 14,
        bold: false,
        italic: true,
        strike: true,
        underline: 'doubleAccounting' as const,
        vertical: 'superscript' as const,
        color: { kind: 'rgb' as const, argb: '80112233' },
      },
    },
    { text: '終\t ', font: { color: { kind: 'theme' as const, index: 4, tint: 0.25 }, bold: true } },
    { text: 'indexed', font: { color: { kind: 'indexed' as const, index: 5, tint: -0.2 } } },
    { text: 'auto', font: { color: { kind: 'auto' as const } } },
  ];
  const cell = {
    row: 0,
    column: 0,
    kind: 'string' as const,
    value: runs.map((run) => run.text).join(''),
    runs,
    style: original.style,
  };
  const bytes = await patchWorkbookCells(source, [{ sheetId: '1', cell }]),
    saved = await readXlsxWorkbook(bytes);
  expect(saved.model.sheets[0]!.cells.find((cell) => cell.column === 0)).toEqual(cell);
  expect(saved.model.sheets[0]!.cells.find((cell) => cell.column === 1)).toEqual(
    source.model.sheets[0]!.cells.find((cell) => cell.column === 1),
  );
  for (const [part, content] of before)
    if (!['xl/worksheets/sheet1.xml', 'xl/workbook.xml', 'xl/calcChain.xml'].includes(part))
      expect(saved.parts.get(part)).toEqual(content);
  expect(source.parts).toEqual(before);
  const xml = saved.parts.get('xl/worksheets/sheet1.xml')!.toString();
  expect(xml).toContain('t="inlineStr"');
  expect(xml).toContain('xml:space="preserve"');
  expect(xml).toContain('_x005F_x0041_');
  expect(xml).toContain('_x000D_');
  const independent = new ExcelJS.Workbook();
  await independent.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(independent.worksheets[0]!.getCell('A1').text).toBe(cell.value);
});
it('retains rich typed input through actual formula calculation and an independent reopen', async () => {
  const source = await fixture(),
    original = source.model.sheets[0]!.cells[0]!,
    runs = [
      { text: 'new', font: { bold: true } },
      { text: ' text', font: { italic: true } },
    ];
  const result = await calculateWorkbookCellEdits(source, [
    { sheetId: '1', cell: { row: 0, column: 0, kind: 'string', value: 'new text', runs, style: original.style } },
  ]);
  expect(result.model.sheets[0]!.cells[0]).toMatchObject({ value: 'new text', runs });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Uint8Array.from(result.bytes).buffer);
  expect(book.worksheets[0]!.getCell('A1').value).toEqual({ richText: runs });
  expect(book.worksheets[0]!.getCell('C1').result).toBe(2);
});
it.each([
  { value: 'mismatch', runs: [{ text: 'other' }] },
  { value: 'bad\u0001', runs: [{ text: 'bad\u0001' }] },
  { value: 'bad\ud800', runs: [{ text: 'bad\ud800' }] },
  { value: 'ok', runs: [{ text: 'ok', font: { name: 'bad\u0001' } }] },
  { value: 'ok', formula: '=1+1', runs: [{ text: 'ok' }] },
])('refuses malformed rich edits without flattening or producing output', async (patch) => {
  expect(workbookCellSchema.safeParse({ row: 0, column: 0, kind: 'string', ...patch }).success).toBe(false);
  const source = await fixture(),
    before = new Map(source.parts);
  await expect(
    patchWorkbookCells(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'string', ...patch } as never }]),
  ).rejects.toThrow();
  expect(source.parts).toEqual(before);
});
it('preserves opaque run properties for unambiguous text-only changes and refuses replacing ambiguous formatting', async () => {
  const source = await fixture();
  const JSZip = (await import('jszip')).default,
    zip = new JSZip();
  for (const [part, bytes] of source.parts) zip.file(part, bytes);
  const part = 'xl/sharedStrings.xml',
    opaque = '<scheme val="minor"/><x:opaque xmlns:x="urn:rich:test" marker="keep"/>';
  zip.file(part, (await zip.file(part)!.async('string')).replace('</rPr>', `${opaque}</rPr>`));
  const original = await readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' })),
    cell = original.model.sheets[0]!.cells[0]!;
  if (cell.kind !== 'string') throw new Error('Missing rich fixture.');
  const runs = structuredClone(cell.runs!);
  runs[0]!.text = 'new ';
  const changed = { ...cell, value: runs.map((run) => run.text).join(''), runs };
  const saved = await readXlsxWorkbook(await patchWorkbookCells(original, [{ sheetId: '1', cell: changed }]));
  expect(saved.parts.get('xl/worksheets/sheet1.xml')!.toString()).toContain(opaque);
  expect(saved.parts.get(part)).toEqual(original.parts.get(part));
  runs[0]!.font!.bold = false;
  await expect(patchWorkbookCells(original, [{ sheetId: '1', cell: { ...changed, runs } }])).rejects.toThrow(
    'Unrepresented source run formatting',
  );
});
it.each([{ runs: [] }, { runs: [{ text: '', font: { bold: true } }] }])(
  'roundtrips empty rich text without losing its explicit run font',
  async ({ runs }) => {
    const source = await fixture(),
      style = source.model.sheets[0]!.cells[0]!.style,
      cell = { row: 0, column: 0, kind: 'string' as const, value: '', runs, style };
    const saved = await readXlsxWorkbook(await patchWorkbookCells(source, [{ sheetId: '1', cell }]));
    expect(saved.model.sheets[0]!.cells[0]).toEqual(cell);
  },
);
