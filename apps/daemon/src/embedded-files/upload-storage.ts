import path from 'node:path';
import multer, { type StorageEngine } from 'multer';
import { withEmbeddedProject } from './pinned-project.js';

type Metadata = Record<string, unknown>;
declare global {
  namespace Express {
    namespace Multer {
      interface File {
        embeddedStat?: { size: number; mtimeMs: number };
        embeddedRemove?: () => Promise<void>;
      }
    }
  }
}
type Uploaded = Express.Multer.File;

/** Ordinary installations retain upstream disk storage. Embedded uploads never
 * expose a host pathname to Multer or to the response/cleanup handlers. */
export function embeddedUploadStorage(options: {
  fallback: StorageEngine;
  metadata: (id: string) => Metadata | null;
  decodeName: (name: string) => string;
  sanitizeName: (name: string) => string;
  sanitizePath: (name: string) => string;
}): StorageEngine {
  const staged = multer.memoryStorage();
  return {
    _handleFile(req, file, callback) {
      try {
      const metadata = options.metadata(req.params.id as string);
      if (metadata?.embeddedHost !== 'evebot') return options.fallback._handleFile(req, file, callback);
      file.originalname = options.decodeName(file.originalname);
      // The single-file endpoint owns conditional replacement and versioning.
      // Stage under Multer's existing byte limit; only its authorized handler
      // may commit the bytes. Bulk asset uploads retain contained streaming.
      if (req.route?.path === '/api/projects/:id/files') return staged._handleFile(req, file, callback);
      const id = req.params.id as string;
      const relDir = typeof req.body?.dir === 'string' && req.body.dir.trim() ? options.sanitizePath(req.body.dir.trim()) : '';
      Object.assign(req, { _uploadRelDir: relDir });
      const safe = options.sanitizeName(file.originalname);
      const previous = (req as typeof req & { _embeddedUploadTail?: Promise<unknown> })._embeddedUploadTail ?? Promise.resolve();
      const operation = previous.catch(() => {}).then(() => withEmbeddedProject(id, metadata, async (project) => {
        const parsed = path.parse(safe);
        for (let index = 0; index < 10_000; index++) {
          const filename = index ? `${parsed.name}-${index}${parsed.ext}` : safe;
          const relative = relDir ? `${relDir}/${filename}` : filename;
          try { await project.stat(relative); continue; }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
          // A concurrent writer winning this name causes a failure, never an
          // overwrite. Same-request files are serialized in multipart order.
          const stat = await project.upload(relative, file.stream, 200 * 1024 * 1024);
          return { filename, size: stat.size, embeddedStat: { size: stat.size, mtimeMs: stat.mtimeMs },
            embeddedRemove: () => withEmbeddedProject(id, metadata, async (current) => {
              const actual = await current.stat(relative);
              if (actual.ino === stat.ino && actual.dev === stat.dev) await current.remove(relative);
            }),
          };
        }
        throw new Error('Project upload filename collision limit exceeded.');
      }));
      Object.assign(req, { _embeddedUploadTail: operation });
      operation.then((result) => callback(null, result), (error) => callback(error));
      } catch (error) { callback(error as Error); }
    },
    _removeFile(req, file: Uploaded, callback) {
      if (Buffer.isBuffer(file.buffer)) return staged._removeFile(req, file, callback);
      if (!file.embeddedRemove) return options.fallback._removeFile(req, file, callback);
      file.embeddedRemove().then(() => callback(null), callback);
    },
  };
}
