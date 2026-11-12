/** Embedded companion: local visual-workspace services only. Do not import
 * server.ts here: its module/bootstrap owns the standalone agent and cloud
 * services. File/history/comment implementations remain shared upstream code. */
import fs from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Response, type ErrorRequestHandler } from "express";
import multer, { type StorageEngine } from "multer";
import * as store from "./db.js";
import * as projectFiles from "./projects.js";
import { secureEmbeddedDataRoot } from "./embedded-files/private-data-root.js";
import { embeddedUploadStorage } from "./embedded-files/upload-storage.js";
import {
  installEmbeddedStudioBoundary,
  registerEmbeddedStudioRoutes,
} from "./routes/embedded-studio.js";
import { registerEmbeddedCatalogueRoutes } from "./routes/embedded-catalogue.js";
import { registerEmbeddedWorkbookRoutes } from "./routes/embedded-workbooks.js";
import {
  registerProjectFileRoutes,
  registerProjectUploadRoutes,
} from "./routes/project/index.js";
import { registerProjectCommentRoutes } from "./routes/project/comments.js";
import { createProjectPreviewScopeRegistry } from "./project-preview-scopes.js";
import { createSseResponse } from "./http/sse.js";
import { captureJsonBodySize } from "./http/json-body-size.js";
import { buildDocumentPreview } from "./document-preview.js";
import { validateArtifactManifestInput } from "./artifacts/manifest.js";
import { subscribe } from "./project-watchers.js";
import { resolveProjectRoot } from "./project-root.js";
import {
  resolveDaemonResourceRoot,
  resolveDaemonResourceDir,
  resolveProcessResourcesPath,
} from "./daemon-paths.js";
import { listSkills } from "./skills.js";
import { listDesignSystems } from "./design-systems/index.js";
import type { AuthorizeProjectRequest } from "./collab/project-request-authority.js";
import type { StartServerOptions } from "./server.js";

export async function startServer({
  host = "127.0.0.1",
  port = 0,
}: StartServerOptions = {}) {
  if (process.env.OD_EMBEDDED_STUDIO !== "1" || host !== "127.0.0.1")
    throw new Error(
      "Embedded Studio requires explicit embedded mode and loopback binding.",
    );
  const data = process.env.OD_DATA_DIR;
  if (!data || !path.isAbsolute(data))
    throw new Error(
      "Embedded Studio requires an explicit absolute data directory.",
    );
  secureEmbeddedDataRoot(data);
  const projectRoot = resolveProjectRoot(
    path.dirname(fileURLToPath(import.meta.url)),
  );
  const resourceRoot = resolveDaemonResourceRoot({
    safeBases: [projectRoot, resolveProcessResourcesPath()],
  });
  const resource = (name: string) =>
    resolveDaemonResourceDir(resourceRoot, name, path.join(projectRoot, name));
  const paths = {
    PROJECTS_DIR: path.join(data, "projects"),
    DESIGN_SYSTEMS_DIR: resource("design-systems"),
    USER_DESIGN_SYSTEMS_DIR: path.join(data, "design-systems"),
  };
  await mkdir(paths.PROJECTS_DIR, { recursive: true, mode: 0o700 });
  const db = store.openDatabase(projectRoot, { dataDir: data });
  const app = express();
  installEmbeddedStudioBoundary(app);
  app.use(express.json({ limit: "64mb", verify: captureJsonBodySize }));
  const sendApiError = (
    res: Response,
    status: number,
    code: string,
    message: string,
  ) => res.status(status).json({ error: { code, message } });
  const sendMulterError = (res: Response, error: Error) =>
    sendApiError(
      res,
      error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
        ? 413
        : 400,
      "UPLOAD_FAILED",
      error.message,
    );
  const authorizeProjectRequest: AuthorizeProjectRequest = async (
    _req,
    res,
    projectId,
  ) => {
    const project = store.getProject(db, projectId);
    if (!project || project.metadata?.embeddedHost !== "evebot") {
      sendApiError(res, 404, "PROJECT_NOT_FOUND", "Project not found");
      return false;
    }
    return true;
  };
  const rejectUnbound: StorageEngine = {
    _handleFile(_req, _file, callback) {
      callback(new Error("Uploads require a bound Evebot project."));
    },
    _removeFile(_req, _file, callback) {
      callback(null);
    },
  };
  const upload = multer({
    storage: embeddedUploadStorage({
      fallback: rejectUnbound,
      metadata: (id) => store.getProject(db, id)?.metadata ?? null,
      decodeName: projectFiles.decodeMultipartFilename,
      sanitizeName: projectFiles.sanitizeName,
      sanitizePath: projectFiles.sanitizePath,
    }),
    limits: {
      fileSize: 200 * 1024 * 1024,
      files: 12,
      fieldSize: 64 * 1024 * 1024,
    },
  });
  const context = {
    db,
    paths,
    http: { sendApiError, sendMulterError },
    node: { fs },
    projectStore: store,
    projectFiles,
    authorizeProjectRequest,
    uploads: { upload, handleProjectUpload: upload.array("files", 12) },
    documents: { buildDocumentPreview },
    artifacts: { validateArtifactManifestInput },
    projectPreviewScopes: createProjectPreviewScopeRegistry(),
    isProjectEditingBusy: () => false,
  };
  registerEmbeddedStudioRoutes(app, db);
  registerEmbeddedWorkbookRoutes(app, db, paths.PROJECTS_DIR);
  registerEmbeddedCatalogueRoutes(app, {
    noticeRoot: resourceRoot ?? projectRoot,
    skills: resource("skills"),
    templates: resource("design-templates"),
    designSystems: paths.DESIGN_SYSTEMS_DIR,
  });
  registerProjectFileRoutes(app, context);
  registerProjectUploadRoutes(app, context);
  registerProjectCommentRoutes(app, {
    db,
    projectStore: store,
    conversations: store,
  });
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, profile: "embedded-studio" }),
  );
  app.get("/api/projects/:id", async (req, res) => {
    if (
      !(await authorizeProjectRequest(req, res, req.params.id, {
        mode: "read",
      }))
    )
      return;
    const project = store.getProject(db, req.params.id)!;
    return res.json({
      project: { ...project, workspaceId: null },
      resolvedDir: projectFiles.resolveProjectDir(
        paths.PROJECTS_DIR,
        project.id,
        project.metadata,
      ),
    });
  });
  app.get("/api/projects/:id/tabs", async (req, res) => {
    if (
      await authorizeProjectRequest(req, res, req.params.id, { mode: "read" })
    )
      res.json(store.listTabs(db, req.params.id));
  });
  app.put("/api/projects/:id/tabs", async (req, res) => {
    if (
      !(await authorizeProjectRequest(req, res, req.params.id, {
        mode: "write",
        capability: "writeFiles",
      }))
    )
      return;
    const { tabs = [], active = null, browserTabs = [] } = req.body ?? {};
    if (
      !Array.isArray(tabs) ||
      !tabs.every((tab) => typeof tab === "string") ||
      !Array.isArray(browserTabs)
    )
      return sendApiError(res, 400, "INVALID_TABS", "Invalid project tabs.");
    return res.json(
      store.setTabs(db, req.params.id, {
        tabs,
        active: typeof active === "string" ? active : null,
        browserTabs,
      }),
    );
  });
  const cleanups = new Set<() => Promise<void>>();
  app.get("/api/projects/:id/events", async (req, res) => {
    if (
      !(await authorizeProjectRequest(req, res, req.params.id, {
        mode: "read",
      }))
    )
      return;
    const project = store.getProject(db, req.params.id)!;
    const stream = createSseResponse(res);
    const subscription = subscribe(
      paths.PROJECTS_DIR,
      project.id,
      (event) => stream.send("file-changed", event),
      { metadata: project.metadata },
    );
    let done: Promise<void> | undefined;
    const cleanup = () =>
      (done ??= (async () => {
        stream.end();
        await subscription.unsubscribe();
        cleanups.delete(cleanup);
      })());
    cleanups.add(cleanup);
    res.once("close", () => {
      void cleanup().catch(() => {});
    });
    void subscription.ready
      .then(() => stream.send("ready", { projectId: project.id }))
      .catch(() => {
        void cleanup().catch(() => {});
      });
  });
  for (const [area, root, key] of [
    ["skills", resource("skills"), "skills"],
    ["design-templates", resource("design-templates"), "designTemplates"],
  ] as const) {
    app.get(`/api/${area}`, async (_req, res) =>
      res.json({
        [key]: (await listSkills(root)).map(
          ({ dir: _dir, body, ...entry }) => ({
            ...entry,
            hasBody: Boolean(body),
          }),
        ),
      }),
    );

  }
  app.get("/api/design-systems", async (_req, res) =>
    res.json({
      designSystems: await listDesignSystems(paths.DESIGN_SYSTEMS_DIR),
    }),
  );
  app.use((_req, res) =>
    sendApiError(res, 404, "NOT_FOUND", "Embedded Studio operation not found."),
  );
  const requestError: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) return next(error);
    const status =
      error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
        ? 413
        : error?.status === 400
          ? 400
          : 500;
    return sendApiError(
      res,
      status,
      "EMBEDDED_REQUEST_FAILED",
      "Studio request failed.",
    );
  };
  app.use(requestError);
  const server = app.listen(port, host);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Embedded Studio did not bind.");
  return {
    server,
    url: `http://${host}:${address.port}`,
    shutdown: async () => {
      await Promise.allSettled([...cleanups].map((cleanup) => cleanup()));
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      store.closeDatabase();
    },
  };
}
