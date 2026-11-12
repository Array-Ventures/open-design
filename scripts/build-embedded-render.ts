import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.resolve(process.argv[2] ?? path.join(root, '.tmp', 'embedded-render'));
if (output === root || root.startsWith(output + path.sep)) throw new Error('Use a dedicated build directory');
await mkdir(output, { recursive: true });
// Worker imports resolve shared package exports, so refresh their compiled
// dependency closure before bundling the isolated runtime.
execFileSync('corepack', ['pnpm', '--filter', '@open-design/daemon^...', '--workspace-concurrency=1', 'run', '--if-present', 'build'], { cwd: root, stdio: 'inherit' });
execFileSync('corepack', ['pnpm', '--filter', '@open-design/daemon', 'exec', 'esbuild', 'src/embedded-render/main.ts', '--bundle', '--platform=node', '--format=esm', '--target=node24', '--external:playwright-core', '--banner:js=import { createRequire as __odWorkerCreateRequire } from "node:module"; const require = __odWorkerCreateRequire(import.meta.url);', `--metafile=${path.join(output, 'bundle-inputs.json')}`, `--outfile=${path.join(output, 'worker.mjs')}`], { cwd: root, stdio: 'inherit' });
// Validate the final banner+bundle before producing an executable image.
execFileSync(process.execPath, ['--check', path.join(output, 'worker.mjs')], { cwd: root, stdio: 'inherit' });
// Bundle the shared converter as one browser closure: serialized functions must
// retain their helper references independently of the Node worker's bundler.
execFileSync('corepack', ['pnpm', '--filter', '@open-design/daemon', 'exec', 'esbuild', '../../packages/deck-export/src/index.ts', '--bundle', '--platform=browser', '--format=iife', '--global-name=odDeckExport', '--target=chrome130', `--outfile=${path.join(output, 'deck-export.iife.js')}`], { cwd: root, stdio: 'inherit' });
const pptxVendor = path.join(root, 'apps/desktop/vendor/dom-to-pptx');
const pptxBundle = gunzipSync(await readFile(path.join(pptxVendor, 'dom-to-pptx.bundle.js.gz')));
await writeFile(path.join(output, 'dom-to-pptx.bundle.js'), pptxBundle);
const require = createRequire(path.join(root, 'apps/daemon/package.json'));
const hyperframes = path.dirname(require.resolve('hyperframes/package.json'));
await cp(path.join(hyperframes, 'dist/hyperframe.runtime.iife.js'), path.join(output, 'hyperframe.runtime.iife.js'));
const playwright = path.dirname(require.resolve('playwright-core/package.json'));
await cp(playwright, path.join(output, 'node_modules/playwright-core'), { recursive: true, force: true, dereference: true });
await cp(path.join(root, 'deploy/Dockerfile.embedded-render'), path.join(output, 'Dockerfile'));
const licenses = path.join(output, 'licenses'); await mkdir(licenses, { recursive: true });
await cp(path.join(root, 'LICENSE'), path.join(licenses, 'open-design-LICENSE'));
await cp(path.join(pptxVendor, 'LICENSE'), path.join(licenses, 'dom-to-pptx-LICENSE'));
await cp(path.join(pptxVendor, 'README.md'), path.join(licenses, 'dom-to-pptx-README.md'));
const metadata = JSON.parse(await readFile(path.join(output, 'bundle-inputs.json'), 'utf8')) as { inputs: Record<string, unknown> };
const packages = new Set<string>([playwright, hyperframes]);
for (const input of Object.keys(metadata.inputs)) {
  const resolved = path.resolve(root, 'apps/daemon', input);
  const match = /^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(resolved);
  if (match?.[1]) packages.add(match[1]);
}
for (const directory of packages) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')) as { name: string; version: string; license?: string };
  const destination = path.join(licenses, `${manifest.name.replace(/[^a-z0-9.-]/gi, '_')}-${manifest.version}`);
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, 'package.json'), JSON.stringify({ name: manifest.name, version: manifest.version, license: manifest.license }, null, 2));
  for (const name of await readdir(directory)) if (/^(?:LICENSE|LICENCE|COPYING|NOTICE)(?:[.-]|$)/i.test(name)) await cp(path.join(directory, name), path.join(destination, name), { recursive: true });
}
const worker = await readFile(path.join(output, 'worker.mjs'));
const sha256 = createHash('sha256').update(worker).digest('hex');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0;
await writeFile(path.join(output, 'provenance.json'), JSON.stringify({ schemaVersion: 1, sourceCommit, dirty, workerSha256: sha256, editablePptx: { version: '2.0.1', vendorSha256: createHash('sha256').update(pptxBundle).digest('hex'), converterSha256: createHash('sha256').update(await readFile(path.join(output, 'deck-export.iife.js'))).digest('hex') }, playwright: JSON.parse(await readFile(path.join(playwright, 'package.json'), 'utf8')).version, hyperframes: { version: JSON.parse(await readFile(path.join(hyperframes, 'package.json'), 'utf8')).version, runtimeSha256: createHash('sha256').update(await readFile(path.join(output, 'hyperframe.runtime.iife.js'))).digest('hex') }, formats: ['html', 'pdf', 'image', 'pptx', 'mp4', 'webm', 'mp3', 'wav', 'hyperframes', 'docx', 'markdown', 'workbook', 'xlsx'] }, null, 2) + '\n');
process.stdout.write(`Render bundle: ${output}\nWorker SHA256: ${sha256}\n`);
