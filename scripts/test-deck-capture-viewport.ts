import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Actual immutable worker/content proof. Requires local Python Pillow; no
// browser, converter, library or worker overlay is mounted into the image.
const image = process.argv[2];
if (!image || !/^sha256:[a-f0-9]{64}$/.test(image)) throw Error('Pass an existing local immutable renderer image ID.');
const root = fileURLToPath(new URL('..', import.meta.url)), exec = promisify(execFile);
const require = createRequire(path.join(root, 'apps/daemon/package.json')), JSZip = require('jszip');
const scratch = await mkdtemp(path.join(tmpdir(), 'od-deck-capture-')), source = path.join(scratch, 'source');
await mkdir(source);
const actor = userInfo(), receipts: object[] = [], hashes = new Map<string, string>();
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const pixels = `import sys,json
from PIL import Image
im=Image.open(sys.argv[1]).convert('RGBA');w,h=map(int,sys.argv[2:4]);assert im.size==(w,h),(im.size,(w,h))
corners=[im.getpixel(p) for p in [(5,5),(w-5,5),(5,h-5),(w-5,h-5)]]
assert all(p==(255,255,255,255) for p in corners),('clipped authored white canvas',corners)
ink=sum(1 for r,g,b,a in im.crop((60,55,min(w,750),150)).getdata() if a==255 and r<90 and 25<g<120 and 55<b<160)
assert ink>100,('authored blue title is missing',ink)
print(json.dumps({'dimensions':[w,h],'corners':corners,'titleInkPixels':ink}))`;
function fixture(width: number, height: number, attributes: string, custom = false, legacy = false) {
  const content = '<section class="slide"><h1>First retained title</h1><p>Ordinary body one</p></section><section class="slide"><h1>Second retained title</h1><p>Ordinary body two</p></section>';
  const runtime = custom ? `<script>customElements.define('deck-stage',class extends HTMLElement{connectedCallback(){const slides=Array.from(this.querySelectorAll('.slide'));const show=n=>slides.forEach((s,i)=>s.style.display=i===n?'block':'none');show(0);addEventListener('message',e=>{if(e.data&&e.data.type==='od:slide')show(e.data.index)});}});</script>` : '';
  return `<!doctype html><html><head><style>body{margin:0}deck-stage{${custom ? `display:block;width:${width}px;height:${height}px;overflow:hidden` : ''}}.slide{position:relative;width:${width}px;height:${height}px;box-sizing:border-box;background:#fff}h1{position:absolute;left:60px;top:55px;margin:0;font-family:Georgia;font-size:44px;color:#123456}p{position:absolute;left:60px;top:200px;margin:0;font-family:Arial;font-size:28px;color:#333}</style></head><body>${legacy ? content : `<deck-stage transition="push" ${attributes}>${content}</deck-stage>`}${runtime}</body></html>`;
}
async function run(name: string, html: string, width: number, height: number, viewport: { width: number; height: number }, format = 'pptx', pin = false, refused = false) {
  const fileName = name + '.html', bytes = Buffer.from(html); hashes.set(fileName, hash(bytes)); await writeFile(path.join(source, fileName), bytes);
  const directory = path.join(scratch, name), output = path.join(directory, 'output'), job = path.join(directory, 'job');
  await mkdir(output, { recursive: true }); await mkdir(job);
  const input = { fileName, format, deck: true, ...viewport, ...(pin ? { index: 0, deckSourceSha256: hash(bytes), deckSourcePath: 'path-0-0' } : {}) };
  await writeFile(path.join(job, 'input.json'), JSON.stringify(input));
  const container = `od-deck-capture-${randomUUID()}`;
  try {
    try { await exec('docker', ['run', '--pull', 'never', '--name', container, '--label', 'od.deck-capture-test=true', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '256', '--memory', '1g', '--cpus', '1', '--shm-size', '128m', '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m', '--user', `${actor.uid}:${actor.gid}`, '--mount', `type=bind,src=${source},dst=/source,readonly`, '--mount', `type=bind,src=${output},dst=/output`, '--mount', `type=bind,src=${job},dst=/job,readonly`, image!], { timeout: 90_000, maxBuffer: 256 * 1024 }); } catch (error) { if (!refused) throw error; }
    const result = JSON.parse(await readFile(path.join(output, 'result.json'), 'utf8'));
    if (refused) { assert.equal(result.ok, false); assert.match(result.error, /export limit/); receipts.push({ name, input, result }); return; }
    assert.equal(result.ok, true, result.error);
    const artifact = await readFile(path.join(output, result.file)), decoded: object[] = [];
    const images = format === 'image' ? [artifact] : await (async () => {
      const zip = await JSZip.loadAsync(artifact), files = Object.keys(zip.files).filter(name => /^ppt\/media\/.*\.png$/.test(name)).sort();
      assert.equal(files.length, 2); return Promise.all(files.map(name => zip.file(name).async('nodebuffer')));
    })();
    for (const [index, bytes] of images.entries()) {
      const file = path.join(output, `decoded-${index}.png`); await writeFile(file, bytes);
      decoded.push(JSON.parse((await exec('python3', ['-c', pixels, file, String(width), String(height)])).stdout));
    }
    receipts.push({ name, input, result, outputSha256: hash(artifact), decoded });
  } finally { await exec('docker', ['rm', '-f', container]).catch(() => {}); }
}
try {
  await run('default-stage', fixture(800, 450, ''), 800, 450, { width: 800, height: 450 });
  await run('explicit-stage', fixture(800, 450, 'width="800" height="450"'), 800, 450, { width: 320, height: 240 });
  await run('large-stage', fixture(1600, 900, 'width="1600" height="900"'), 1600, 900, { width: 800, height: 450 });
  await run('custom-attributes', fixture(800, 450, 'width="800" height="450"', true), 800, 450, { width: 320, height: 240 });
  await run('custom-layout', fixture(1000, 600, '', true), 1000, 600, { width: 320, height: 240 });
  await run('legacy', fixture(800, 450, '', false, true), 800, 450, { width: 800, height: 450 });
  await run('source-owned-image', fixture(800, 450, ''), 800, 450, { width: 800, height: 450 }, 'image', true);
  await run('unbounded-stage', fixture(800, 450, 'width="5000" height="450"'), 800, 450, { width: 800, height: 450 }, 'pptx', false, true);
  await run('responsive-growth', fixture(800, 450, '').replace('width:800px;height:450px;box-sizing', 'width:200vw;height:450px;box-sizing'), 800, 450, { width: 800, height: 450 }, 'pptx', false, true);
  for (const [file, expected] of hashes) assert.equal(hash(await readFile(path.join(source, file))), expected);
  process.stdout.write(JSON.stringify({ ok: true, scratch, cases: receipts.length }) + '\n');
} finally {
  await writeFile(path.join(scratch, 'receipt.json'), JSON.stringify({ image, sourceCommit: (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim(), sourceDirty: Boolean((await exec('git', ['status', '--porcelain'], { cwd: root })).stdout.trim()), hashes: Object.fromEntries(hashes), receipts }, null, 2));
  process.stdout.write(`Retained deck content evidence: ${scratch}\n`);
}
