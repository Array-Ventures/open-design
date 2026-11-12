import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { workbookPreviewSchema } from '@open-design/contracts/runtime/workbook';
import { readCsvDocument, patchCsvDocument, CSV_LIMITS } from '../artifacts/csv/document.js';
import { WorkbookFormatError } from '../artifacts/workbook/package.js';
/** Runs inside the existing bounded, networkless renderer. Candidate bytes are
 * retained by its ordinary receipt/history pipeline, never installed here. */
export async function renderCsv(output: string, input: { fileName: string; format: 'workbook' | 'xlsx' | 'csv'; dataFile?: string; restore?: { fileName: string; sourceSha256: string; targetSha256: string } }, asset: (name: string) => Promise<Buffer>): Promise<{ file: string; mime: string }> {
  if (input.format === 'xlsx' || !/\.csv$/i.test(input.fileName)) throw new WorkbookFormatError('CSV sources remain CSV; conversion to XLSX is not supported.', 'WORKBOOK_UNSUPPORTED');
  const bytes = await asset(input.fileName), sourceSha256 = createHash('sha256').update(bytes).digest('hex');
  if (input.restore) {
    if (input.format !== 'csv' || input.dataFile || input.restore.sourceSha256 !== sourceSha256) throw new WorkbookFormatError('The CSV changed after this restore was selected.');
    const retained = await asset(input.restore.fileName);
    if (retained.length > CSV_LIMITS.bytes || createHash('sha256').update(retained).digest('hex') !== input.restore.targetSha256) throw new WorkbookFormatError('The retained CSV revision does not match this restore.');
    readCsvDocument(retained);
    await writeFile(path.join(output, 'artifact.csv'), retained, { flag: 'wx', mode: 0o600 });
    return { file: 'artifact.csv', mime: 'text/csv' };
  }
  const source = readCsvDocument(bytes); let prepared: ReturnType<typeof patchCsvDocument> | undefined;
  if (input.dataFile) {
    const plan = await asset(input.dataFile);
    if (plan.length > 16 * 1024 * 1024) throw new WorkbookFormatError('CSV edit plan exceeds its byte limit.', 'WORKBOOK_LIMIT');
    prepared = patchCsvDocument(source, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plan)));
  }
  if (input.format === 'workbook') {
    const body = Buffer.from(JSON.stringify(workbookPreviewSchema.parse({ sourceSha256, model: prepared?.model ?? source.model })));
    if (body.length > 32 * 1024 * 1024) throw new WorkbookFormatError('CSV preview exceeds its byte limit.', 'WORKBOOK_LIMIT');
    await writeFile(path.join(output, 'artifact.json'), body, { flag: 'wx', mode: 0o600 });
    return { file: 'artifact.json', mime: 'application/json' };
  }
  await writeFile(path.join(output, 'artifact.csv'), prepared?.bytes ?? bytes, { flag: 'wx', mode: 0o600 });
  return { file: 'artifact.csv', mime: 'text/csv' };
}
