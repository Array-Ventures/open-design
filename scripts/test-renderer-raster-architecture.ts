import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Execute the actual Dockerfile guard without emulating an x86 native codec.
// Docker target names differ from Node/Sharp names; mismatches must still fail.
const dockerfile = await readFile(new URL('../deploy/Dockerfile.embedded-render', import.meta.url), 'utf8');
const guards = dockerfile.split('\n').filter(line => line.startsWith('RUN ') && line.includes('raster-platform'));
assert.equal(guards.length, 1); const guard = guards[0]!.slice(4);
const scratch = await mkdtemp(path.join(tmpdir(), 'od-raster-architecture-')), exec = promisify(execFile);
try {
  for (const [attested, dockerArch, expected] of [
    ['linux-arm64', 'arm64', true], ['linux-x64', 'amd64', true],
    ['linux-arm64', 'amd64', false], ['linux-x64', 'arm64', false],
    ['linux-amd64', 'amd64', false], ['linux-x64', 'x64', false],
    ['linux-arm', 'arm', false], ['linux-s390x', 's390x', false],
  ] as const) {
    await writeFile(path.join(scratch, 'raster-platform'), attested + '\n');
    let accepted = true;
    try { await exec('/bin/sh', ['-c', guard], { cwd: scratch, env: { PATH: '/usr/bin:/bin', TARGETARCH: dockerArch } }); }
    catch { accepted = false; }
    assert.equal(accepted, expected, `${attested} must ${expected ? 'match' : 'refuse'} Docker ${dockerArch}`);
  }
  process.stdout.write('Actual Dockerfile raster architecture guard: 8 controls PASS\n');
} finally { await rm(scratch, { recursive: true, force: true }); }
