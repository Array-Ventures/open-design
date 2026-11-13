import type { WorkspaceCollabContext } from '@open-design/contracts';
import { projectFileUrl } from '../providers/registry';

const absoluteSource = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** Preserve actual filename spaces and refuse a parent traversal above the project. */
export function normalizeMarkdownProjectPath(value: string): string | null {
  if (/[\\\u0000]/.test(value)) return null;
  const parts: string[] = [];
  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return null; parts.pop(); }
    else parts.push(part);
  }
  return parts.join('/') || null;
}
export function markdownDirectory(fileName: string): string {
  const normalized = normalizeMarkdownProjectPath(fileName);
  return normalized?.slice(0, Math.max(0, normalized.lastIndexOf('/'))) ?? '';
}
export function markdownImageProjectPath(fileName: string, src: string): string | null {
  const source = src.trim();
  if (!source || absoluteSource.test(source)) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(source.split(/[?#]/, 1)[0]!); } catch { return null; }
  if (!decoded) return null;
  return normalizeMarkdownProjectPath(decoded.startsWith('/') ? decoded.slice(1) : `${markdownDirectory(fileName)}/${decoded}`);
}
export function markdownImageSourceUrl(projectId: string, fileName: string, src: string, workspaceContext?: WorkspaceCollabContext | null): string | null {
  const source = src.trim();
  if (absoluteSource.test(source)) return source;
  const path = markdownImageProjectPath(fileName, source);
  return path ? projectFileUrl(projectId, path, workspaceContext) : null;
}
export function markdownRelativeProjectPath(fileName: string, targetPath: string): string {
  const target = normalizeMarkdownProjectPath(targetPath);
  if (!target) throw new Error('The image path is outside this project.');
  const from = markdownDirectory(fileName).split('/').filter(Boolean);
  const to = target.split('/');
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) common++;
  return [...Array.from({ length: from.length - common }, () => '..'), ...to.slice(common)].join('/') || target;
}
