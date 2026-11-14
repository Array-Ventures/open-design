import { expect, it } from 'vitest';
import type { IDocumentData } from '@univerjs/core';
import { defaultWorkbookCellInput } from '../../src/components/embedded/workbook/default-cell-input';
it.each(['surrogate','overlap','nonfinite','drawing','annotation','unknown-document','paragraph-format'] as const)('keeps unsupported %s input on its original guarded path',kind=>{
  const doc:IDocumentData={id:'editor',documentStyle:{},body:{dataStream:'😀2\r\n',paragraphs:[{startIndex:3,paragraphId:'input'}],textRuns:[{st:0,ed:3,ts:{}}]}};
  if(kind==='surrogate')doc.body!.textRuns![0]!.ed=1;
  if(kind==='overlap')doc.body!.textRuns!.push({st:1,ed:3,ts:{}});
  if(kind==='nonfinite')doc.body!.textRuns![0]!.ts={fs:NaN};
  if(kind==='drawing')doc.drawings={authored:{}} as unknown as IDocumentData['drawings'];
  if(kind==='annotation')doc.body!.customRanges=[{startIndex:0,endIndex:2,rangeId:'authored'}] as NonNullable<IDocumentData['body']>['customRanges'];
  if(kind==='unknown-document')Object.assign(doc,{unknownAuthoredData:{keep:true}});
  if(kind==='paragraph-format')doc.body!.paragraphs![0]!.paragraphStyle={horizontalAlign:2};
  const before=structuredClone(doc);
  expect(defaultWorkbookCellInput(doc,{})).toBeUndefined();expect(doc).toEqual(before);
});
