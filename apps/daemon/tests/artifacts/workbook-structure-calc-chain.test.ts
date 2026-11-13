import { expect, it } from 'vitest';
import ExcelJS from 'exceljs-community';
import { execFileSync } from 'node:child_process';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { calculateWorkbookCellEdits } from '../../src/artifacts/workbook/calculated-patch.js';
import { patchWorkbookStructure } from '../../src/artifacts/workbook/structure-patch.js';
import { writeWorkbookPackage } from '../../src/artifacts/workbook/package.js';
import { xmlPart } from '../../src/artifacts/workbook/parts.js';
import { writeWorkbookXml } from '../../src/artifacts/workbook/xml.js';

async function fixture() {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('Constant').getCell('B2').value = { formula: '1+1', result: 2 };
  const source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer())), parts = new Map(source.parts);
  const rels = xmlPart(parts, 'xl/_rels/workbook.xml.rels');
  const relation = rels.createElementNS(rels.documentElement!.namespaceURI, 'Relationship');
  relation.setAttribute('Id', 'calculation-chain'); relation.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain'); relation.setAttribute('Target', 'calcChain.xml');
  rels.documentElement!.appendChild(relation); parts.set('xl/_rels/workbook.xml.rels', writeWorkbookXml(rels));
  const types = xmlPart(parts, '[Content_Types].xml');
  const type = types.createElementNS(types.documentElement!.namespaceURI, 'Override');
  type.setAttribute('PartName', '/xl/calcChain.xml'); type.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml');
  types.documentElement!.appendChild(type); parts.set('[Content_Types].xml', writeWorkbookXml(types));
  parts.set('xl/calcChain.xml', Buffer.from('<calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="B2" i="1"/></calcChain>'));
  return readXlsxWorkbook(await writeWorkbookPackage(parts));
}

it('removes the obsolete chain when a constant formula moves with no scalar edit', async () => {
  const source = await fixture(), sheet = source.model.sheets[0]!;
  expect(source.model.worksheetStructureEditable).toBe(true);
  const result = await calculateWorkbookCellEdits(source, [], [], [], [], [{ sheetId: sheet.id,
    sourceRows: sheet.rowCount, sourceColumns: sheet.columnCount,
    rows: Array.from({ length: sheet.rowCount + 1 }, (_, index) => index === 1 ? null : index < 1 ? index : index - 1),
    columns: Array.from({ length: sheet.columnCount }, (_, index) => index) }]);
  const independent = JSON.parse(execFileSync('python3', ['-c', `
import io,json,sys,zipfile,xml.etree.ElementTree as E
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:
 print(json.dumps({'chain':'xl/calcChain.xml' in z.namelist(),
  'relationships':[r.get('Type') for r in E.fromstring(z.read('xl/_rels/workbook.xml.rels'))],
  'types':[r.get('PartName') for r in E.fromstring(z.read('[Content_Types].xml'))],
  'cells':{c.get('r'):[c.findtext('{*}f'),c.findtext('{*}v')] for c in E.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('.//{*}c')}}))
`], { input: result.bytes, encoding: 'utf8' }));
  expect(independent.cells).toEqual({ B3: ['1+1', '2'] });
  expect(independent.chain).toBe(false);
  expect(independent.relationships.some((type: string) => type.endsWith('/calcChain'))).toBe(false);
  expect(independent.types).not.toContain('/xl/calcChain.xml');
  const saved = await readXlsxWorkbook(result.bytes);
  for (const [part, bytes] of source.parts) if (!['xl/worksheets/sheet1.xml', 'xl/calcChain.xml', 'xl/_rels/workbook.xml.rels', '[Content_Types].xml'].includes(part)) expect(saved.parts.get(part), part).toEqual(bytes);
});

it('preserves the chain and every package part when there is no structural projection', async () => {
  const source = await fixture(), saved = await readXlsxWorkbook(await patchWorkbookStructure(source, []));
  expect([...saved.parts.keys()].sort()).toEqual([...source.parts.keys()].sort());
  for (const [part, bytes] of source.parts) expect(saved.parts.get(part), part).toEqual(bytes);
});
