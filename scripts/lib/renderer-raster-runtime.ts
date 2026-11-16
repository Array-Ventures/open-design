import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Select Linux/glibc explicitly, never a host macOS/musl binary. A cross-build
 * must install the pinned target optional packages before creating its context. */
export async function copyRendererRasterRuntime(root: string, output: string, architecture = process.arch) {
  if (!['arm64', 'x64'].includes(architecture)) throw new Error('The raster renderer requires a Linux arm64/x64 target.');
  const require = createRequire(path.join(root, 'apps/daemon/package.json'));
  const sharpRoot = path.dirname(path.dirname(require.resolve('sharp')));
  const sharpRequire = createRequire(path.join(sharpRoot, 'package.json'));
  const native = `@img/sharp-linux-${architecture}`, vips = `@img/sharp-libvips-linux-${architecture}`;
  const names = ['sharp', '@img/colour', 'detect-libc', 'semver', native, vips];
  const packages: string[] = [];
  const roots = new Map<string, string>();
  for (const name of names) {
    const directory = name === 'sharp' ? sharpRoot : path.dirname(sharpRequire.resolve(`${name}/${name === native || name === vips ? 'package' : 'package.json'}`));
    roots.set(name, directory);
    packages.push(directory);
    const target = path.join(output, 'node_modules', name);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(directory, target, { recursive: true, dereference: true, filter: entry => path.basename(entry) !== 'node_modules' });
  }
  const manifest = JSON.parse(await readFile(path.join(sharpRoot, 'package.json'), 'utf8')) as { version: string; dependencies: Record<string, string> };
  if (Object.keys(manifest.dependencies).some(name => !names.includes(name))) throw new Error('Review the raster runtime dependency closure before packaging.');
  await writeFile(path.join(output, 'raster-platform'), `linux-${architecture}\n`);
  const hash = async (file: string) => createHash('sha256').update(await readFile(file)).digest('hex');
  return { packages, provenance: {
    sharp: manifest.version, platform: `linux-${architecture}`, addonSha256: await hash(path.join(roots.get(native)!, 'lib', `sharp-linux-${architecture}-${manifest.version}.node`)), libvipsSha256: await hash(sharpRequire.resolve(`${vips}/binary`)),
  } };
}
