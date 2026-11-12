import { z } from 'zod';

export const RenderInput = z.object({
  fileName: z.string().min(1).max(500).refine((value) => value.split('/').every((part) => part && part !== '.' && part !== '..' && !/[\\\0]/.test(part)), 'Use a project-relative source file'),
  dataFile: z.string().min(1).max(500).refine((value) => value.split('/').every((part) => part && part !== '.' && part !== '..' && !/[\\\0]/.test(part)), 'Use a project-relative JSON file').optional(),
  format: z.enum(['html', 'pdf', 'image', 'pptx', 'mp4', 'webm', 'mp3', 'wav', 'hyperframes', 'docx', 'markdown', 'workbook', 'xlsx']),
  imageFormat: z.enum(['png', 'jpeg']).default('png'),
  deck: z.boolean().default(false),
  editable: z.boolean().optional(),
  width: z.number().int().min(320).max(3840).optional(),
  height: z.number().int().min(240).max(2160).optional(),
  index: z.number().int().min(0).max(199).optional(),
  title: z.string().max(160).default('Artifact'),
}).strict().refine(input => !['docx', 'markdown'].includes(input.format) || !input.deck && /\.(html?|md|markdown)$/i.test(input.fileName), { message: 'Document exports require an HTML or Markdown document.' }).refine((input) => !input.editable || input.format === 'pptx', { path: ['editable'], message: 'Editable output is available only for PPTX.' }).refine((input) => !input.dataFile || ['html', 'pdf', 'image', 'pptx', 'workbook', 'xlsx'].includes(input.format), { path: ['dataFile'], message: 'JSON data is available only for template exports or workbook edit plans.' }).refine(input => !['workbook', 'xlsx'].includes(input.format) || /\.xlsx$/i.test(input.fileName) && !input.deck && input.width === undefined && input.height === undefined && input.index === undefined, { message: 'Workbook processing requires an XLSX file without deck or capture options.' });
export type RenderInput = z.infer<typeof RenderInput>;
