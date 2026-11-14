import ExcelJS from 'exceljs-community';
import { expect, it } from 'vitest';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { patchWorkbookSheets } from '../../src/artifacts/workbook/sheet-patch.js';
import { child, children, xmlPart } from '../../src/artifacts/workbook/parts.js';
import { writeWorkbookPackage } from '../../src/artifacts/workbook/package.js';
import { writeWorkbookXml } from '../../src/artifacts/workbook/xml.js';

async function fixture() {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('Source').getCell('A1').value = 12;
  book.addWorksheet('Summary').getCell('A1').value = 17;
  return readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
}

it('qualifies ordinary membership without rewriting any imported package part', async () => {
  const source = await fixture(), before = new Map([...source.parts].map(([name, bytes]) => [name, Buffer.from(bytes)]));
  const again = await readXlsxWorkbook(await writeWorkbookPackage(source.parts));
  expect(again.model).toMatchObject({ worksheetStructureEditable: true, worksheetMembershipEditable: true });
  for (const [name, bytes] of before) expect(again.parts.get(name), name).toEqual(bytes);
});

it.each(['extended titles', 'unknown document property', 'very hidden', 'unbounded numeric identity'] as const)(
  'keeps structural cell geometry usable while refusing membership with %s', async reason => {
    const source = await fixture(), parts = new Map(source.parts);
    if (reason === 'extended titles') {
      const document = xmlPart(parts, 'docProps/app.xml');
      child(document.documentElement!, 'HeadingPairs')!.textContent = '';
      parts.set('docProps/app.xml', writeWorkbookXml(document));
    } else if (reason === 'unknown document property') {
      parts.set('docProps/custom.xml', Buffer.from('<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"/>'));
    } else {
      const document = xmlPart(parts, 'xl/workbook.xml');
      const sheet = children(child(document.documentElement!, 'sheets')!, 'sheet')[1]!;
      if (reason === 'very hidden') sheet.setAttribute('state', 'veryHidden');
      else sheet.setAttribute('sheetId', '65536');
      parts.set('xl/workbook.xml', writeWorkbookXml(document));
    }
    const imported = await readXlsxWorkbook(await writeWorkbookPackage(parts));
    expect(imported.model).toMatchObject({ worksheetStructureEditable: true, worksheetMembershipEditable: false });
    for (const [name, bytes] of parts) expect(imported.parts.get(name), name).toEqual(bytes);
    // A preview capability is descriptive, never authority for the real writer.
    Object.assign(imported.model, { worksheetMembershipEditable: true });
    const target = imported.model.sheets.map(sheet => ({ sheetId: sheet.id, name: sheet.name, origin: 'source' as const }));
    target[0]!.name = 'Renamed';
    await expect(patchWorkbookSheets(imported, target)).rejects.toThrow();
  },
);

it('does not advertise membership for a source with unsupported frozen view ownership', async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Frozen'); sheet.getCell('A1').value = 12;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  expect(source.model).toMatchObject({ worksheetStructureEditable: false, worksheetMembershipEditable: false });
});
