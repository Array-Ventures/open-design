import type {
  ProjectFilesResponse,
  ProjectDetailResponse,
  ProjectPreviewUrlResponse,
  ProjectFileVersionResponse,
  ProjectTabsState,
  PreviewComment,
} from "@open-design/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
// Boot must succeed without importing standalone bootstrap: its factories own
// the upstream routine runner, cloud publishing, diagnostics and provider loops.
vi.mock("../src/server.js", () => {
  throw new Error("Standalone server must not load in embedded mode.");
});
import {
  startDaemonRuntime,
  type StartedDaemonRuntime,
} from "../src/daemon-startup.js";
const id = "18a8301a-b6e1-4001-8000-c967b1eab222";
const token = "owned-embedded-server-fixture-credential";
let scratch: string;
let runtime: StartedDaemonRuntime | undefined;
let directory: string;
const headers = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
};
beforeEach(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "od-embedded-boot-"));
  const data = path.join(scratch, "state");
  await mkdir(data, { mode: 0o700 });
  const workspace = path.join(scratch, "workspaces");
  await mkdir(workspace, { mode: 0o700 });
  directory = path.join(workspace, "team/projects", id);
  await mkdir(directory, { recursive: true });
  vi.stubEnv("OD_EMBEDDED_STUDIO", "1");
  vi.stubEnv("OD_EMBEDDED_TOKEN", token);
  vi.stubEnv("OD_DATA_DIR", data);
  vi.stubEnv("OD_EMBEDDED_WORKSPACE_ROOT", workspace);
});
afterEach(async () => {
  await runtime?.stop();
  runtime = undefined;
  vi.unstubAllEnvs();
  await rm(scratch, { recursive: true, force: true });
});
async function boot() {
  runtime = await startDaemonRuntime({ host: "127.0.0.1", port: 0 });
  const response = await fetch(runtime.url + "/api/embedded/projects", {
    method: "POST",
    headers,
    body: JSON.stringify({
      id,
      name: "Embedded",
      kind: "prototype",
      directory,
    }),
  });
  expect(response.status).toBe(201);
  return runtime.url;
}
it("boots real project/file/preview/history services without the standalone server module", async () => {
  const base = await boot();
  expect(await (await fetch(base + "/api/health")).json()).toEqual({
    ok: true,
    profile: "embedded-studio",
  });
  await writeFile(
    path.join(directory, "index.html"),
    "<!doctype html><h1>Bot authored</h1>",
  );
  const listing = await fetch(`${base}/api/projects/${id}/files`, { headers });
  expect(listing.status, await listing.clone().text()).toBe(200);
  const files = (await listing.json()) as ProjectFilesResponse;
  expect(files.files).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: "index.html" })]),
  );
  const detail = (await (
    await fetch(`${base}/api/projects/${id}`, { headers })
  ).json()) as ProjectDetailResponse;
  expect(detail.project.id).toBe(id);
  expect(detail.resolvedDir).toBe(directory);
  const preview = (await (
    await fetch(`${base}/api/projects/${id}/preview-url?file=index.html`, {
      headers,
    })
  ).json()) as ProjectPreviewUrlResponse;
  const rendered = await fetch(base + preview.url, { headers });
  expect(rendered.status).toBe(200);
  expect(rendered.headers.get("content-security-policy")).toContain(
    "sandbox allow-scripts",
  );
  expect(await rendered.text()).toContain("Bot authored");
  const saved = await fetch(`${base}/api/projects/${id}/files`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "manual.html",
      content: "<h1>Manual edit</h1>",
      source: "manual",
    }),
  });
  expect(saved.status).toBe(200);
  expect(await readFile(path.join(directory, "manual.html"), "utf8")).toContain(
    "Manual edit",
  );
  const versions = await fetch(
    `${base}/api/projects/${id}/files/manual.html/versions`,
    { headers },
  );
  expect(versions.status).toBe(200);
  expect(
    ((await versions.json()) as { versions: ProjectFileVersionResponse[] })
      .versions.length,
  ).toBeGreaterThan(0);
  for (const [method, route] of [
    ["GET", "/api/preview/isolation"],
    ["POST", "/api/runs/start"],
    ["POST", "/api/routines"],
    ["POST", "/api/media/config"],
  ] as const)
    expect((await fetch(base + route, { method, headers })).status).toBe(403);
  expect((await fetch(`${base}/api/projects/${id}/files`)).status).toBe(401);
});
it("preserves authenticated comment ownership, tabs and descriptor-backed multipart upload", async () => {
  const base = await boot();
  const body = new FormData();
  body.set(
    "files",
    new Blob(["fixture asset"], { type: "text/plain" }),
    "asset.txt",
  );
  const uploaded = await fetch(`${base}/api/projects/${id}/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body,
  });
  expect(uploaded.status, await uploaded.clone().text()).toBe(200);
  expect(await readFile(path.join(directory, "asset.txt"), "utf8")).toBe(
    "fixture asset",
  );
  const tabs = await fetch(`${base}/api/projects/${id}/tabs`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ tabs: ["asset.txt"], active: "asset.txt" }),
  });
  expect(tabs.status).toBe(200);
  expect(((await tabs.json()) as ProjectTabsState).active).toBe("asset.txt");
  await writeFile(
    path.join(directory, "index.html"),
    '<h1 data-od-id="title">Title</h1>',
  );
  const comment = await fetch(
    `${base}/api/projects/${id}/conversations/${id}/comments`,
    {
      method: "POST",
      headers: { ...headers, "x-od-host-human": "alice" },
      body: JSON.stringify({
        note: "Edit title",
        target: {
          filePath: "index.html",
          elementId: "title",
          selector: "#title",
          label: "Title",
          text: "Title",
          htmlHint: "<h1>Title</h1>",
          position: { x: 0, y: 0, width: 100, height: 20 },
        },
        authorMemberId: "evebot:mallory",
      }),
    },
  );
  expect(comment.status).toBe(200);
  expect(
    ((await comment.json()) as { comment: PreviewComment }).comment
      .authorMemberId,
  ).toBe("evebot:alice");
});

it("rejects a workspace whose private-root invariant is lost", async () => {
  const base = await boot();
  await chmod(path.join(scratch, "workspaces"), 0o755);
  expect(
    (await fetch(`${base}/api/projects/${id}/files`, { headers })).status,
  ).toBe(400);
});

it("streams real bot filesystem changes and closes its pinned watcher with the client", async () => {
  const base = await boot();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 8000);
  try {
    const response = await fetch(`${base}/api/projects/${id}/events`, {
      headers,
      signal: abort.signal,
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";
    const until = async (text: string) => {
      while (!received.includes(text)) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("Studio event stream ended early.");
        received += decoder.decode(chunk.value, { stream: true });
      }
    };
    await until("event: ready");
    await writeFile(
      path.join(directory, "bot-update.html"),
      "<h1>Live bot update</h1>",
    );
    await until("event: file-changed");
    expect(received).toContain("bot-update.html");
    await reader.cancel();
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
});
it("returns structured errors for malformed JSON without exposing a stack", async () => {
  const base = await boot();
  const response = await fetch(`${base}/api/projects/${id}/tabs`, {
    method: "PUT",
    headers,
    body: "{",
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: {
      code: "EMBEDDED_REQUEST_FAILED",
      message: "Studio request failed.",
    },
  });
});
