import { expect, it } from 'vitest';
import ExcelJS from 'exceljs-community';
import JSZip from 'jszip';
import { calculateWorkbookCellEdits } from '../../src/artifacts/workbook/calculated-patch.js';
import { workbookDocumentSchema } from '@open-design/contracts/runtime/workbook';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
const metadata = '<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray"><metadataTypes count="1"><metadataType name="XLDAPR" cellMeta="1"/></metadataTypes><futureMetadata name="XLDAPR" count="1"><bk><extLst><ext uri="{BDBB8CDC-FA1E-496E-A857-3C3F30C029C3}"><xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext></extLst></bk></futureMetadata><cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>';
async function fixture(mode: 'fixed' | 'dynamic' | 'unknown') {
 const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Inputs'); sheet.getCell('A1').value = { formula:'SEQUENCE(3)', result:55 }; sheet.getCell('A2').value = 56; sheet.getCell('A3').value = 57;
 const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer()), part='xl/worksheets/sheet1.xml';
 zip.file(part,(await zip.file(part)!.async('string')).replace('<f>','<f t="array" ref="A1:A3">').replace('r="A1"',mode==='fixed'?'r="A1"':'r="A1" cm="1"'));
 if(mode!=='fixed') { zip.file('xl/metadata.xml',metadata.replace('fDynamic="1"',mode==='unknown'?'fDynamic="0"':'fDynamic="1"')); const rel='xl/_rels/workbook.xml.rels';zip.file(rel,(await zip.file(rel)!.async('string')).replace('</Relationships>','<Relationship Id="metadata" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata" Target="metadata.xml"/></Relationships>')); }
 return readXlsxWorkbook(await zip.generateAsync({type:'nodebuffer'}));
}
it.each(['fixed','dynamic','unknown'] as const)('derives %s source calculation proof from actual OOXML without changing caches',async mode=> {
 const source=await fixture(mode);expect(source.model.calculationMetadata).toBe(mode==='unknown'?'unsupported':'verified');expect(source.model.sheets[0]!.arrayFormulas?.[0]!.calculation).toBe(mode==='unknown'?'unsupported':mode);expect(source.model.sheets[0]!.cells[0]!.value).toBe(55);expect(source.parts.get('xl/worksheets/sheet1.xml')?.toString()).toContain('<v>55</v>');
});

it('keeps ordinary source caches readable when cell metadata cannot be qualified',async()=>{
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Inputs');sheet.getCell('A1').value={formula:'1+1',result:55};
 const zip=await JSZip.loadAsync(await book.xlsx.writeBuffer()),part='xl/worksheets/sheet1.xml';const xml=(await zip.file(part)!.async('string')).replace('r="A1"','r="A1" cm="1"');zip.file(part,xml);
 const source=await readXlsxWorkbook(await zip.generateAsync({type:'nodebuffer'}));expect(source.model.calculationMetadata).toBe('unsupported');expect(source.model.sheets[0]!.arrayFormulas).toEqual([]);expect(source.model.sheets[0]!.cells[0]!.value).toBe(55);expect(source.parts.get(part)?.toString()).toBe(xml);
});

it('keeps older absence unknown and never accepts an asserted mode as writer permission',async()=>{
 const source=await fixture('fixed'),old=structuredClone(source.model);delete old.calculationMetadata;delete old.sheets[0]!.arrayFormulas![0]!.calculation;const parsed=workbookDocumentSchema.parse(old);expect(parsed.calculationMetadata).toBeUndefined();expect(parsed.sheets[0]!.arrayFormulas![0]!.calculation).toBeUndefined();
 source.model.sheets[0]!.arrayFormulas![0]!.calculation='dynamic';
 await expect(calculateWorkbookCellEdits(source,[{sheetId:'1',cell:{row:0,column:0,kind:'number',value:999,formula:'=SEQUENCE(4)'}}])).rejects.toMatchObject({code:'WORKBOOK_UNSUPPORTED'});
});
