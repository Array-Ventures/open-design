import { expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs-community';
import JSZip from 'jszip';
import { partitionRetiredFollowerEdits, assertRetiredFollowersOutsideOwners } from '../../src/artifacts/workbook/retired-array-followers.js';
import { verifiedDynamicArrayOwners } from '../../src/artifacts/workbook/dynamic-array-metadata.js';
import { FWorkbook } from '@univerjs/sheets/facade';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { calculateWorkbookCellEdits } from '../../src/artifacts/workbook/calculated-patch.js';
const metadata='<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray"><metadataTypes count="1"><metadataType name="XLDAPR" cellMeta="1"/></metadataTypes><futureMetadata name="XLDAPR" count="1"><bk><extLst><ext uri="{BDBB8CDC-FA1E-496E-A857-3C3F30C029C3}"><xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext></extLst></bk></futureMetadata><cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>';
async function fixture(mode:'dynamic'|'fixed'|'unknown'|'retained'='dynamic', second?:'overlap'|'changes') {
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Inputs'),summary=book.addWorksheet('Summary');sheet.getCell('A1').value=3;sheet.getCell('D3').value={formula:mode==='retained'?'MISSING(A1)':'SEQUENCE(A1,1,10)',result:10};sheet.getCell('D4').value=11;sheet.getCell('D4').font={italic:true};sheet.getCell('D5').value=12;sheet.getCell('J1').value='keep';summary.getCell('A1').value={formula:'Inputs!D4+100',result:111};
 if(second==='overlap'){sheet.getCell('B1').value=1;sheet.getCell('D5').value=null;sheet.getCell('C5').value={formula:'SEQUENCE(1,B1,100)',result:100};}if(second==='changes')sheet.getCell('H1').value={formula:'IF(D4=42,SEQUENCE(2),SEQUENCE(1))',result:1};
 const zip=await JSZip.loadAsync(await book.xlsx.writeBuffer()),path='xl/worksheets/sheet1.xml';let xml=await zip.file(path)!.async('string');xml=xml.replace(/(<c r="D3"[^>]*)(>)/,`$1${mode==='fixed'?'':' cm="1"'}$2`).replace(/(<c r="D3"[^>]*>.*?)<f>/,'$1<f t="array" ref="D3:D5">');
 if(second){const ref=second==='overlap'?'C5':'H1';xml=xml.replace(new RegExp(`(<c r="${ref}"[^>]*)(>)`),'$1 cm="1"$2').replace(new RegExp(`(<c r="${ref}"[^>]*>.*?)<f>`),`$1<f t="array" ref="${ref}:${ref}">`);}zip.file(path,xml);
 if(mode!=='fixed'){zip.file('xl/metadata.xml',mode==='unknown'?metadata.replace('fDynamic="1"','fDynamic="0"'):metadata);const rel='xl/_rels/workbook.xml.rels';zip.file(rel,(await zip.file(rel)!.async('string')).replace('</Relationships>','<Relationship Id="metadata" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata" Target="metadata.xml"/></Relationships>'));}
 return readXlsxWorkbook(await zip.generateAsync({type:'nodebuffer'}));
}
function edits(source:Awaited<ReturnType<typeof fixture>>, value:number=42) {return [{sheetId:'1',cell:{row:0,column:0,kind:'number' as const,value:1}},{sheetId:'1',cell:{row:3,column:3,kind:'number' as const,value,style:source.model.sheets[0]!.cells.find(cell=>cell.row===3&&cell.column===3)!.style}}];}
it('admits a retired source follower only after server-derived shrink, then reopens exact input42 with bounded final calculation',async()=>{
 const source=await fixture(),before=new Map(source.parts),save=vi.spyOn(FWorkbook.prototype,'save');
 try {
  const result=await calculateWorkbookCellEdits(source,edits(source),[{sheetId:'1',axis:'column',index:0,size:146}],[{sheetId:'1',row:3,column:3,bold:true}]);expect(save).toHaveBeenCalledTimes(4);
  const book=new ExcelJS.Workbook();await book.xlsx.load(Uint8Array.from(result.bytes).buffer);expect(book.worksheets[0]!.getCell('D3').result).toBe(10);expect(book.worksheets[0]!.getCell('D4').value).toBe(42);expect(book.worksheets[0]!.getCell('D4').font).toMatchObject({italic:true,bold:true});expect(book.worksheets[1]!.getCell('A1').result).toBe(142);
  expect(result.model.sheets[0]!.arrayFormulas?.[0]!.range.endRow).toBe(2);expect(result.model.sheets[0]!.columnDimensions.find(item=>item.index===0)?.width).toBe(146);
  const output=await readXlsxWorkbook(result.bytes);for(const [part,bytes]of source.parts)if(!['xl/worksheets/sheet1.xml','xl/worksheets/sheet2.xml','xl/workbook.xml','xl/styles.xml'].includes(part))expect(output.parts.get(part)).toEqual(bytes);expect(source.parts).toEqual(before);
 }finally{save.mockRestore();}
});
it.each(['fixed','unknown','retained'] as const)('refuses %s ownership without changing any source byte',async mode=>{const source=await fixture(mode),before=new Map(source.parts);await expect(calculateWorkbookCellEdits(source,edits(source))).rejects.toMatchObject({code:'WORKBOOK_UNSUPPORTED'});expect(source.parts).toEqual(before);});
it('refuses active followers and the pin’s ambiguous cross-array cache transfer before admission',async()=>{
 const source=await fixture();await expect(calculateWorkbookCellEdits(source,edits(source).slice(1))).rejects.toMatchObject({code:'WORKBOOK_UNSUPPORTED'});
 const overlapping=await fixture('dynamic','overlap');await expect(calculateWorkbookCellEdits(overlapping,[edits(overlapping)[0]!,{sheetId:'1',cell:{row:4,column:3,kind:'number',value:42}},{sheetId:'1',cell:{row:0,column:1,kind:'number',value:3}}])).rejects.toMatchObject({code:'WORKBOOK_UNSUPPORTED'});
});
it('refuses deferred inputs that alter another owner topology, rather than reusing a provisional result',async()=>{
 const source=await fixture('dynamic','changes'),before=new Map(source.parts);await expect(calculateWorkbookCellEdits(source,edits(source))).rejects.toThrow('topology');expect(source.parts).toEqual(before);
});

it('checks every admitted owner rectangle, not only the old owner of a deferred coordinate', async()=>{
 const source=await fixture(),plan=partitionRetiredFollowerEdits(source,edits(source),verifiedDynamicArrayOwners(source));
 const admitted=(await calculateWorkbookCellEdits(source,plan.ordinary)).model;expect(()=>assertRetiredFollowersOutsideOwners(admitted,plan)).not.toThrow();
 admitted.sheets[0]!.cells.push({row:3,column:2,formula:'=SEQUENCE(1,3)',kind:'number',value:1});admitted.sheets[0]!.arrayFormulas!.push({kind:'array',calculation:'dynamic',row:3,column:2,range:{startRow:3,endRow:3,startColumn:2,endColumn:4}});
 expect(()=>assertRetiredFollowersOutsideOwners(admitted,plan)).toThrow('still owned');
});
