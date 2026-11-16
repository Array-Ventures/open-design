import { writeFileSync } from 'node:fs';
import { buildSync, version } from 'esbuild';

// Run the real builder in its native Node realm, not jsdom's mixed typed-array
// realm. Compile errors remain fatal before any calculation owner is created.
const [entry, output, metadata] = process.argv.slice(2);
if (!entry || !output || !metadata) throw Error('Worker build requires entry, output and metadata paths.');
const result = buildSync({
  entryPoints: [entry], outfile: output, bundle: true, platform: 'browser',
  format: 'iife', target: 'es2022', metafile: true, logLevel: 'silent',
});
writeFileSync(metadata, JSON.stringify({ version, metafile: result.metafile }) + '\n', { flag: 'wx' });
