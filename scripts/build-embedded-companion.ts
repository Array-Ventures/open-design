import { detachPackageHardlinks } from './lib/package-hardlinks.js';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createRequire } from 'node:module';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url));
const { values } = parseArgs({ options: { out: { type: 'string' }, 'allow-dirty': { type: 'boolean', default: false } } });
if (!values.out) throw new Error('Pass --out with a new dedicated build directory.');
const output = path.resolve(values.out);
if (output === root || root.startsWith(output + path.sep)) throw new Error('Use a dedicated output directory.');
try { await lstat(output); throw new Error('Build output already exists; choose a fresh directory.'); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sourceCommit = git('rev-parse', 'HEAD');
const dirty = git('status', '--porcelain').length > 0;
if (dirty && !values['allow-dirty']) throw new Error('Production companion packages require a clean pinned fork commit. --allow-dirty is for isolated development only.');
async function sourceDigest() {
const sourceHash = createHash('sha256');
for (const name of execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).sort()) {
  // Next rewrites this generated type-reference file for each dist directory;
  // it is not authored runtime source and is restored after the build.
  if (name === 'apps/web/next-env.d.ts') continue;
  const file = path.join(root, name);
  try {
    const info = await lstat(file);
    sourceHash.update(name + '\0');
    sourceHash.update(info.isSymbolicLink() ? await readlink(file) : await readFile(file));
    sourceHash.update('\0');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
  return sourceHash.digest('hex');
}
const sourceTreeSha256 = await sourceDigest();
const env = { ...process.env, OD_EMBEDDED_STUDIO: '1', OD_STUDIO_BASE_PATH: '/studio', OD_WEB_OUTPUT_MODE: 'standalone', OD_WEB_DIST_DIR: '.next-embedded-package', OD_EMBEDDED_BUILD_ID: sourceTreeSha256 };
const pnpm = (...args: string[]) => execFileSync('corepack', ['pnpm', ...args], { cwd: root, env, stdio: 'inherit' });
const nextEnvironmentFile = path.join(root, 'apps/web/next-env.d.ts');
const originalNextEnvironment = await readFile(nextEnvironmentFile);
try {
  // Build the package-manager dependency closure before either app. A source
  // digest must never describe code paired with stale shared dist exports.
  pnpm('--filter', '@open-design/daemon^...', '--filter', '@open-design/web^...', '--workspace-concurrency=1', 'run', '--if-present', 'build');
  pnpm('--filter', '@open-design/daemon', 'build');
  pnpm('--filter', '@open-design/web', 'build');
} finally { await writeFile(nextEnvironmentFile, originalNextEnvironment); }
await mkdir(path.dirname(output), { recursive: true });
const staging = await mkdtemp(path.join(path.dirname(output), '.studio-build-'));
try {
  await mkdir(path.join(staging, 'apps'), { recursive: true });
  const deployedDaemon = path.join(staging, 'apps/daemon');
  pnpm('--filter', '@open-design/daemon', 'deploy', '--legacy', '--prod', '--ignore-scripts', deployedDaemon);
  await detachPackageHardlinks(deployedDaemon);
  // pnpm's deployment copy uses published package files, which omit SQLite's
  // locally built native addon. Include the installed, platform-matched binary.
  const sourceRequire = createRequire(path.join(root, 'apps/daemon/package.json'));
  const deployedRequire = createRequire(path.join(deployedDaemon, 'package.json'));
  const sourceSqlite = path.dirname(sourceRequire.resolve('better-sqlite3/package.json'));
  const deployedSqlite = path.dirname(deployedRequire.resolve('better-sqlite3/package.json'));
  if (JSON.parse(await readFile(path.join(sourceSqlite, 'package.json'), 'utf8')).version !== JSON.parse(await readFile(path.join(deployedSqlite, 'package.json'), 'utf8')).version) throw new Error('SQLite build and deployment versions differ.');
  await mkdir(path.join(deployedSqlite, 'build/Release'), { recursive: true });
  await cp(path.join(sourceSqlite, 'build/Release/better_sqlite3.node'), path.join(deployedSqlite, 'build/Release/better_sqlite3.node'));
  // Legacy deploy leaves its self-package alias pointing at the build checkout.
  // Rebind that one known alias; the full inventory still rejects other escapes.
  const selfAlias = path.join(deployedDaemon, 'node_modules/.pnpm/node_modules/@open-design/daemon');
  if (await realpath(selfAlias) === path.join(root, 'apps/daemon')) {
    await rm(selfAlias); await symlink(path.relative(path.dirname(selfAlias), deployedDaemon), selfAlias);
  }
  const standalone = path.join(root, 'apps/web/.next-embedded-package/standalone');
  pnpm('exec', 'tsx', '-e', 'import { prepareStandaloneWebArtifact } from "./tools/pack/src/workspace-build.ts"; prepareStandaloneWebArtifact(process.argv[1]).catch(error=>{process.stderr.write(String(error)+"\\n");process.exitCode=1})', standalone);
  await cp(standalone, path.join(staging, 'web'), { recursive: true, verbatimSymlinks: true });
  await cp(path.join(root, 'apps/web/.next-embedded-package/static'), path.join(staging, 'web/apps/web/.next-embedded-package/static'), { recursive: true });
  const publicRoot = path.join(root, 'apps/web/public');
  const fontPolicy = createRequire(import.meta.url)('../apps/web/embedded-fonts.json') as { fonts: string[]; notices: string[] };
  const reviewedFonts = new Set([...fontPolicy.fonts, ...fontPolicy.notices]);
  for (const name of reviewedFonts) {
    if (path.basename(name) !== name) throw new Error('Embedded font policy uses plain filenames.');
    const info = await lstat(path.join(publicRoot, 'fonts', name));
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('A reviewed embedded font or notice is missing or redirected.');
  }
  await cp(publicRoot, path.join(staging, 'web/apps/web/public'), { recursive: true, filter: (source) => {
    const relative = path.relative(publicRoot, source);
    return !relative.startsWith('fonts' + path.sep) || reviewedFonts.has(relative.slice('fonts/'.length));
  } });
  for (const name of ['skills', 'design-templates', 'design-systems', 'craft', 'prompt-templates', 'assets/frames', 'assets/community-pets', 'LICENSE']) await cp(path.join(root, name), path.join(staging, name), { recursive: true });
  // Preserve additional repository-level notices if upstream adds them. LICENSE
  // above stays required; catalogue delivery carries these alongside asset notices.
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isFile() && entry.name !== 'LICENSE' && /(?:^|[-_.])(?:licen[cs]es?|copying|notices?|ofl|copyright)(?=[-_.]|$)/i.test(entry.name)) {
      await cp(path.join(root, entry.name), path.join(staging, entry.name));
    }
  }
  const { createEmbeddedSkillPayload } = await import('../apps/daemon/dist/routes/embedded-catalogue.js');
  const skillPayload = JSON.stringify(await createEmbeddedSkillPayload({ skills: path.join(staging, 'skills'), templates: path.join(staging, 'design-templates'), designSystems: path.join(staging, 'design-systems'), noticeRoot: staging }));
  if (Buffer.byteLength(skillPayload) > 384 * 1024 * 1024) throw new Error('Compiled creative skill payload exceeds its byte limit.');
  await writeFile(path.join(staging, 'skill-packages.json'), skillPayload);
  const files: Record<string, { kind: 'file' | 'link'; sha256: string; bytes: number; executable?: boolean; target?: string }> = {};
  async function inventory(directory: string, prefix = '') {
    for (const name of (await readdir(directory)).sort()) {
      const relative = prefix ? `${prefix}/${name}` : name; const file = path.join(directory, name); const info = await lstat(file);
      if (info.isDirectory()) { await inventory(file, relative); continue; }
      if (info.isSymbolicLink()) {
        const target = await readlink(file); const resolved = await realpath(file);
        if (path.isAbsolute(target) || !resolved.startsWith(staging + path.sep)) throw new Error(`Companion package contains an escaping link: ${relative}`);
        files[relative] = { kind: 'link', bytes: Buffer.byteLength(target), target, sha256: createHash('sha256').update(target).digest('hex') };
      } else {
        if (!info.isFile()) throw new Error(`Unsupported companion package entry: ${relative}`);
        const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk);
        files[relative] = { kind: 'file', bytes: info.size, executable: Boolean(info.mode & 0o111), sha256: hash.digest('hex') };
      }
    }
  }
  // Copied bundles and resource trees must not retain cache aliases either.
  await detachPackageHardlinks(staging);
  await inventory(staging);
  if (await sourceDigest() !== sourceTreeSha256) throw new Error('Source files changed during the companion build. Build again from stable source.');
  const identity = { schemaVersion: 1, bridgeVersion: 1, sourceCommit, sourceTreeSha256, dirty, nodeMajor: 24, platform: process.platform, architecture: process.arch, entries: { daemon: 'apps/daemon/dist/cli.js', web: 'web/apps/web/server.js' }, files };
  for (const entry of Object.values(identity.entries)) if (!files[entry]) throw new Error(`Missing companion entrypoint: ${entry}`);
  const buildId = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  await writeFile(path.join(staging, 'studio-build.json'), JSON.stringify({ ...identity, buildId }, null, 2) + '\n');
  await rename(staging, output);
  process.stdout.write(`Companion build: ${buildId}\nOutput: ${output}\nDevelopment source: ${dirty}\n`);
} finally {
  await rm(staging, { recursive: true, force: true });
  // pnpm legacy deploy can leave a bin-link scratch directory under apps
  // named after its absolute deployment target. It is not a workspace package.
  await rm(path.join(root, 'apps', path.basename(staging)), { recursive: true, force: true });
}
