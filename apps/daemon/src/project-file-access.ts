import { open, stat, type FileHandle } from 'node:fs/promises';
import type { Stats } from 'node:fs';

export interface ProjectFileAccess {
  filePath?: string;
  openFile?: () => Promise<FileHandle>;
}
export interface ResolvedProjectFile extends ProjectFileAccess {
  name: string;
  size: number;
  mtime: number;
  mime: string;
  kind: string;
}
export interface ProjectDeleteAccess {
  name: string;
  filePath?: string;
  stat?: () => Promise<Stats>;
}
export async function statProjectDeleteAccess(access: ProjectDeleteAccess): Promise<Stats> {
  if (access.stat) return access.stat();
  if (!access.filePath) throw new Error('Project deletion target is unavailable.');
  return stat(access.filePath);
}
export async function openProjectFileAccess(access: ProjectFileAccess): Promise<FileHandle> {
  if (access.openFile) return access.openFile();
  if (!access.filePath) throw new Error('Project file access is unavailable.');
  return open(access.filePath, 'r');
}
export async function streamProjectFileAccess(access: ProjectFileAccess, options: NonNullable<Parameters<FileHandle['createReadStream']>[0]> = {}) {
  const file = await openProjectFileAccess(access);
  try { return file.createReadStream({ ...options, autoClose: true }); }
  catch (error) { await file.close(); throw error; }
}
