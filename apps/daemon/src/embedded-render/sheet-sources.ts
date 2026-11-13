import { z } from 'zod';
import type { WorkbookSheetPlanProjection } from '@open-design/contracts/runtime/workbook';
import { WorkbookFormatError, WORKBOOK_PACKAGE_LIMITS } from '../artifacts/workbook/package.js';

export const frozenWorkbookSheetSourceSchema = z.object({ versionId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), versionSha256: z.string().regex(/^[a-f0-9]{64}$/), fileName: z.string() }).strict().refine(source => source.fileName === `.evebot-workbook-sheet-source-${source.versionSha256}.xlsx`, 'Historical worksheet assets require their immutable derived path.');
export const frozenWorkbookSheetSourcesSchema = z.array(frozenWorkbookSheetSourceSchema).min(1).max(64).refine(sources => new Set(sources.map(source => source.versionId)).size === sources.length, 'Historical version identities must be unique.');
export type FrozenWorkbookSheetSource = z.infer<typeof frozenWorkbookSheetSourceSchema>;

/** The host authorizes history; this contained boundary independently requires
 * every inner reference to match a declared frozen version/digest and refuses
 * unused declarations. The selected XML source owner checks actual SHA bytes. */
export async function frozenWorkbookSheetTemplates(sheets: WorkbookSheetPlanProjection | undefined, raw: readonly FrozenWorkbookSheetSource[] | undefined, asset: (name: string) => Promise<Buffer>) {
  const declarations = raw ? frozenWorkbookSheetSourcesSchema.parse(raw) : [];
  const key = (source: {versionId: string; versionSha256: string}) => `${source.versionId}\0${source.versionSha256}`;
  const declared = new Map(declarations.map(source => [key(source), source]));
  const restored = sheets?.filter(sheet => sheet.origin === 'restore') ?? [];
  const needed = new Set(restored.map(sheet => key(sheet.template)));
  if (needed.size !== declared.size || [...needed].some(id => !declared.has(id))) throw new WorkbookFormatError('Historical worksheet frozen declarations do not match this edit plan.');
  const bodies = new Map<string, Buffer>(); let total = 0;
  for (const source of declarations) if (!bodies.has(source.fileName)) {
    const body = await asset(source.fileName); total += body.length;
    if (!Number.isSafeInteger(total) || total > WORKBOOK_PACKAGE_LIMITS.archiveBytes) throw new WorkbookFormatError('Historical worksheet sources exceed their aggregate limit.', 'WORKBOOK_LIMIT');
    bodies.set(source.fileName, body);
  }
  return restored.map(sheet => ({ sheetId: sheet.sheetId, sourceSha256: sheet.template.versionSha256, bytes: bodies.get(declared.get(key(sheet.template))!.fileName)! }));
}
