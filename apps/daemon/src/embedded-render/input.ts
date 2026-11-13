import { z } from 'zod';

export const RenderInput = z.object({
  sheetId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).refine(value => !["__proto__", "constructor", "prototype"].includes(value)).optional(),
  workbookSourceSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  fileName: z.string().min(1).max(500).refine((value) => value.split('/').every((part) => part && part !== '.' && part !== '..' && !/[\\\0]/.test(part)), 'Use a project-relative source file'),
  restore: z.object({ fileName: z.string().min(1).max(500).refine(value => value.split('/').every(part => part && part !== '.' && part !== '..' && !/[\\\0]/.test(part))), sourceSha256: z.string().regex(/^[a-f0-9]{64}$/), targetSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
  dataFile: z.string().min(1).max(500).refine((value) => value.split('/').every((part) => part && part !== '.' && part !== '..' && !/[\\\0]/.test(part)), 'Use a project-relative JSON file').optional(),
  format: z.enum(['html', 'pdf', 'image', 'pptx', 'mp4', 'webm', 'mp3', 'wav', 'hyperframes', 'docx', 'markdown', 'workbook', 'xlsx', 'csv']),
  imageFormat: z.enum(['png', 'jpeg']).default('png'),
  deck: z.boolean().default(false),
  editable: z.boolean().optional(),
  width: z.number().int().min(320).max(3840).optional(),
  height: z.number().int().min(240).max(2160).optional(),
  index: z.number().int().min(0).max(199).optional(),
  title: z.string().max(160).default('Artifact'),
}).strict().refine(input => /\.xlsx$/i.test(input.fileName) && input.format === 'csv' ? Boolean(input.sheetId && input.workbookSourceSha256 && !input.dataFile && !input.restore) : input.sheetId === undefined && input.workbookSourceSha256 === undefined, { message: 'XLSX CSV export requires a selected worksheet and source digest without edits or restore.' }).refine(input => !input.restore || ['xlsx', 'csv'].includes(input.format) && !input.dataFile && !input.deck && input.restore.fileName !== input.fileName, { message: 'Workbook restore requires a separate retained workbook asset without edits.' }).refine(input => !['docx', 'markdown'].includes(input.format) || !input.deck && /\.(html?|md|markdown)$/i.test(input.fileName), { message: 'Document exports require an HTML or Markdown document.' }).refine((input) => !input.editable || input.format === 'pptx', { path: ['editable'], message: 'Editable output is available only for PPTX.' }).refine((input) => !input.dataFile || ['html', 'pdf', 'image', 'pptx', 'workbook', 'xlsx', 'csv'].includes(input.format), { path: ['dataFile'], message: 'JSON data is available only for template exports or workbook edit plans.' }).refine(input => !['workbook', 'xlsx', 'csv'].includes(input.format) || (input.format === 'workbook' ? /\.(xlsx|csv)$/i.test(input.fileName) : input.format === 'csv' ? /\.(xlsx|csv)$/i.test(input.fileName) : /\.xlsx$/i.test(input.fileName)) && !input.deck && input.width === undefined && input.height === undefined && input.index === undefined, { message: 'Workbook processing requires a matching XLSX or CSV file without deck or capture options.' });
export type RenderInput = z.infer<typeof RenderInput>;
