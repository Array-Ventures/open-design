import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { workbookEditPlanSchema, workbookPreviewSchema } from '@open-design/contracts/runtime/workbook';
import { readXlsxWorkbook } from '../artifacts/workbook/reader.js';
import { calculateWorkbookCellEdits } from '../artifacts/workbook/calculated-patch.js';
import { WorkbookFormatError } from '../artifacts/workbook/package.js';

/** Called only by the existing networkless, memory-limited render container.
 * Input is the host's immutable source snapshot; workspace files are not mounted
 * writable and this worker never persists a live edit. */
export async function renderWorkbook(output: string, input: { fileName: string; format: 'workbook' | 'xlsx'; dataFile?: string }, asset: (name: string) => Promise<Buffer>): Promise<{ file: string; mime: string }> {
  const bytes = await asset(input.fileName), sourceSha256 = createHash('sha256').update(bytes).digest('hex');
  const source = await readXlsxWorkbook(bytes);
  let prepared: Awaited<ReturnType<typeof calculateWorkbookCellEdits>> | undefined;
  if (input.dataFile) {
    const plan = await asset(input.dataFile);
    if (plan.length > 16 * 1024 * 1024) throw new WorkbookFormatError('Workbook edit plan exceeds its byte limit.', 'WORKBOOK_LIMIT');
    const parsed = workbookEditPlanSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plan)));
    if (parsed.sourceSha256 !== sourceSha256) throw new WorkbookFormatError('The workbook changed after these edits were prepared. Reload it before exporting these edits.');
    prepared = await calculateWorkbookCellEdits(source, parsed.edits, parsed.dimensions);
  }
  if (input.format === 'workbook') {
    const body = Buffer.from(JSON.stringify(workbookPreviewSchema.parse({ sourceSha256, model: prepared?.model ?? source.model })));
    if (body.length > 32 * 1024 * 1024) throw new WorkbookFormatError('Workbook preview exceeds its byte limit.', 'WORKBOOK_LIMIT');
    await writeFile(path.join(output, 'artifact.json'), body, { flag: 'wx', mode: 0o600 });
    return { file: 'artifact.json', mime: 'application/json' };
  }
  if (source.model.features.macros) throw new WorkbookFormatError('Macro-enabled workbooks cannot be exported as XLSX.', 'WORKBOOK_UNSUPPORTED');
  prepared ??= await calculateWorkbookCellEdits(source, []);
  await writeFile(path.join(output, 'artifact.xlsx'), prepared.bytes, { flag: 'wx', mode: 0o600 });
  return { file: 'artifact.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
}
