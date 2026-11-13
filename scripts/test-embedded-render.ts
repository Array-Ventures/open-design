import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';

const exec = promisify(execFile);
const image = process.argv[2];
if (!image) throw new Error('Pass a locally built render image identity');
const inspected = await exec('docker', ['image', 'inspect', '--format', '{{.Id}}', image]);
const imageId = inspected.stdout.trim();
if (!/^sha256:[0-9a-f]{64}$/.test(imageId)) throw new Error('Expected an immutable local image identity');
const scratch = await mkdtemp(path.join(tmpdir(), 'od-contained-render-'));
const source = path.join(scratch, 'source'); await mkdir(source);
await writeFile(path.join(source, 'asset.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#247955"/></svg>');
await writeFile(path.join(source, 'index.html'), '<!doctype html><html><body><h1>Contained render fixture</h1><img src="asset.svg"></body></html>');
await writeFile(path.join(source, 'deck.html'), '<!doctype html><html><head><style>body{margin:0}.slide{width:800px;height:450px;padding:40px;box-sizing:border-box;font:64px sans-serif}.slide:first-child{background:#fdd}.slide:last-child{background:#ddf}</style></head><body><deck-stage><section class="slide">Slide one</section><section class="slide">Slide two</section></deck-stage><script type="application/json" id="speaker-notes">["Opening note retained","Second note retained"]</script></body></html>');
const daemonRequire = createRequire(path.resolve('apps/daemon/package.json'));
await writeFile(path.join(source, 'gsap.min.js'), await readFile(daemonRequire.resolve('gsap/dist/gsap.min.js')));
await writeFile(path.join(source, 'motion.html'), `<!doctype html><html><head><style>*{margin:0}body{width:320px;height:240px;overflow:hidden}#scene{width:320px;height:240px;background:red}#box{width:40px;height:40px;background:white}</style><script src="gsap.min.js"></script></head><body><div id="scene" data-composition-id="main" data-start="0" data-duration="1" data-width="320" data-height="240" data-fps="12"><div id="box"></div></div><audio src="media.mp4" data-start="0" data-duration="1" data-volume="0.5"></audio><script>window.__timelines={main:gsap.timeline({paused:true}).to('#box',{x:240,y:160,duration:1,ease:'none'})};</script></body></html>`);
await writeFile(path.join(source, 'dashboard-template.html'), '<!doctype html><html><head><title>Dashboard fixture</title><style>body{font-family:sans-serif;padding:32px}td{padding:8px;border-bottom:1px solid #ddd}</style></head><body><h1>{{data.title}}</h1><table><tr data-od-repeat="item in data.rows"><td>{{item.label}}</td><td>{{item.value}}</td></tr></table><p>{{data.note}}</p></body></html>');
await writeFile(path.join(source, 'dashboard-data.json'), JSON.stringify({ title: 'Snapshot dashboard', rows: [{ label: 'Revenue', value: 125 }, { label: 'Expenses', value: 80 }], note: '<script>UNTRUSTED_DATA</script>' }));
await writeFile(path.join(source, 'dashboard-array.json'), '[1,2,3]');
await writeFile(path.join(source, 'dashboard-link.html'), '<a href="{{data.url}}">Untrusted link</a>');
await writeFile(path.join(source, 'dashboard-link-data.json'), JSON.stringify({ url: 'java\tscript:alert(1)' }));
await writeFile(path.join(source, 'dashboard-deck.html'), '<!doctype html><html><head><style>body{margin:0}.slide{width:800px;height:450px;padding:40px;box-sizing:border-box;font:48px sans-serif}</style></head><body><deck-stage><section class="slide">{{data.title}}</section><section class="slide"><div data-od-repeat="item in data.rows">{{item.label}}: {{item.value}}</div></section></deck-stage></body></html>');
await writeFile(path.join(source, 'dashboard-script.html'), '<script>window.EVIL=true</script><p>{{data.title}}</p>');
await writeFile(path.join(source, 'editable-layered.html'), '<!doctype html><html><head><style>body{margin:0}.slide{position:relative;width:800px;height:450px;background:white}.paint{position:absolute;left:40px;top:40px;width:500px;height:200px;background:linear-gradient(30deg,red,blue),linear-gradient(90deg,white,black);background-blend-mode:multiply}h1{position:absolute;top:280px;left:40px;font:40px sans-serif}</style></head><body><section class="slide"><div class="paint"></div><h1>Editable layered fixture</h1></section></body></html>');
await writeFile(path.join(source, 'remote.html'), '<!doctype html><img src="https://unavailable.fixture.invalid/asset.png">');
await mediaTool('ffmpeg', ['-nostdin', '-n', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:r=12:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '/fixtures/source/media.mp4']);
await writeFile(path.join(source, 'playlist.m3u8'), '#EXTM3U\nhttps://outside.fixture.invalid/media.mp4');
async function mediaTool(tool: 'ffmpeg' | 'ffprobe', args: string[]) {
  const actor = userInfo();
  return exec('docker', ['run', '--rm', '--label', 'od.render-test=true', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '256m', '--pids-limit', '64', '--user', `${actor.uid}:${actor.gid}`, '--mount', `type=bind,src=${scratch},dst=/fixtures`, '--entrypoint', `/usr/bin/${tool}`, imageId, ...args], { timeout: 30_000, maxBuffer: 128 * 1024 });
}
const actor = userInfo();
const longWav = Buffer.alloc(44 + 8000 * 2 * 121);
longWav.write('RIFF'); longWav.writeUInt32LE(longWav.length - 8, 4); longWav.write('WAVEfmt ', 8);
longWav.writeUInt32LE(16, 16); longWav.writeUInt16LE(1, 20); longWav.writeUInt16LE(1, 22);
longWav.writeUInt32LE(8000, 24); longWav.writeUInt32LE(16000, 28); longWav.writeUInt16LE(2, 32); longWav.writeUInt16LE(16, 34);
longWav.write('data', 36); longWav.writeUInt32LE(longWav.length - 44, 40);
await writeFile(path.join(source, 'long.wav'), longWav);
async function run(name: string, input: object, ok = true) {
  const directory = path.join(scratch, name); const job = path.join(directory, 'job'); const output = path.join(directory, 'output');
  await mkdir(job, { recursive: true }); await mkdir(output);
  await writeFile(path.join(job, 'input.json'), JSON.stringify(input));
  const container = `od-render-test-${randomUUID()}`;
  try {
    try {
      await exec('docker', ['run', '--name', container, '--label', 'od.render-test=true', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '256', '--memory', '1g', '--cpus', '1', '--shm-size', '128m', '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m', '--user', `${actor.uid}:${actor.gid}`, '--mount', `type=bind,src=${source},dst=/source,readonly`, '--mount', `type=bind,src=${job},dst=/job,readonly`, '--mount', `type=bind,src=${output},dst=/output`, imageId], { timeout: 120_000, maxBuffer: 1024 * 1024 });
    } catch (error) { if (ok) throw error; }
    const result = JSON.parse(await readFile(path.join(output, 'result.json'), 'utf8')) as { ok: boolean; file?: string; pages?: number; error?: string };
    assert.equal(result.ok, ok, `${name}: ${result.error ?? 'unexpected status'}`);
    process.stdout.write(`${name}: ${ok ? 'rendered' : 'refused as expected'}\n`);
    return { result, body: result.file ? await readFile(path.join(output, result.file)) : Buffer.alloc(0) };
  } finally { await exec('docker', ['rm', '-f', container]).catch(() => {}); }
}
const imageResult = await run('page-image', { fileName: 'index.html', format: 'image', width: 800, height: 600 });
assert.equal(imageResult.body.subarray(1, 4).toString(), 'PNG');
const pdf = await run('page-pdf', { fileName: 'index.html', format: 'pdf' }); assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');
const html = await run('single-html', { fileName: 'index.html', format: 'html' }); assert.match(html.body.toString(), /data:image\/svg\+xml/);
const deck = { fileName: 'deck.html', deck: true, width: 800, height: 450 };
const first = await run('deck-image-one', { ...deck, format: 'image', index: 0 });
const second = await run('deck-image-two', { ...deck, format: 'image', index: 1 });
assert.notDeepEqual(first.body, second.body, 'Different slide indices must capture different slides');
assert.equal(first.body.readUInt32BE(16), 800, 'Capture the authored slide width, not preview scaling');
assert.equal(first.body.readUInt32BE(20), 450, 'Capture the authored slide height, not preview scaling');
const pptx = await run('deck-pptx', { ...deck, format: 'pptx' }); assert.equal(pptx.result.pages, 2); assert.equal(pptx.body.subarray(0, 2).toString(), 'PK');
const editable = await run('deck-editable-pptx', { ...deck, format: 'pptx', editable: true });
assert.equal(editable.result.pages, 2);
const JSZip = daemonRequire('jszip');
const editableZip = await JSZip.loadAsync(editable.body);
for (const result of [pptx, editable]) {
  const archive = await JSZip.loadAsync(result.body);
  assert.match(await archive.file('ppt/notesSlides/notesSlide1.xml').async('string'), /Opening note retained/);
  assert.match(await archive.file('ppt/notesSlides/notesSlide2.xml').async('string'), /Second note retained/);
}
const slideOne = await editableZip.file('ppt/slides/slide1.xml').async('string');
const slideTwo = await editableZip.file('ppt/slides/slide2.xml').async('string');
assert.match(slideOne, /<a:t>Slide one<\/a:t>/);
assert.match(slideTwo, /<a:t>Slide two<\/a:t>/);
assert.match(slideOne, /<p:sp>/, 'Slide text must be an editable shape');
// dom-to-pptx normalizes CSS pixels to a ten-inch slide. Preserve the
// authored aspect rather than assuming CSS's 96-dpi physical page size.
const pageSize = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(await editableZip.file('ppt/presentation.xml').async('string'));
assert.ok(pageSize);
assert.ok(Number(pageSize[1]) > 0 && Number(pageSize[2]) > 0);
assert.equal(Number(pageSize[1]) / Number(pageSize[2]), 800 / 450);
const layered = await run('editable-layered-pptx', { fileName: 'editable-layered.html', format: 'pptx', editable: true, width: 800, height: 450 });
const layeredZip = await JSZip.loadAsync(layered.body);
const layeredSlide = await layeredZip.file('ppt/slides/slide1.xml').async('string');
assert.match(layeredSlide, /<a:t>Editable layered fixture<\/a:t>/);
assert.match(layeredSlide, /<p:pic>/, 'Chromium-painted gradients must survive beside editable text');
assert.ok(Object.keys(layeredZip.files).some((name) => /^ppt\/media\/.*\.png$/.test(name)));
await run('editable-image-refused', { fileName: 'index.html', format: 'image', editable: true }, false);
const deckPdf = await run('deck-pdf', { ...deck, format: 'pdf' }); assert.equal(deckPdf.result.pages, 2); assert.equal(deckPdf.body.subarray(0, 4).toString(), '%PDF');
const remote = await run('remote-refused', { fileName: 'remote.html', format: 'image' }, false); assert.match(remote.result.error ?? '', /Bundle remote/);
for (const format of ['mp4', 'webm', 'mp3', 'wav']) {
  const media = await run(`media-${format}`, { fileName: 'media.mp4', format });
  assert.ok(media.body.length > 100, 'Media output contains real encoded bytes');
  const outputFile = path.join(scratch, `media-${format}`, 'output', `artifact.${format}`);
  const probe = await mediaTool('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', '/fixtures/' + path.relative(scratch, outputFile)]);
  const metadata = JSON.parse(probe.stdout);
  assert.ok(Number(metadata.format.duration) > 0 && Number(metadata.format.duration) < 2);
  assert.ok(metadata.streams.some((stream: { codec_type: string }) => stream.codec_type === (['mp4', 'webm'].includes(format) ? 'video' : 'audio')));
}
const playlist = await run('media-playlist-refused', { fileName: 'playlist.m3u8', format: 'mp4' }, false);
assert.match(playlist.result.error ?? '', /not HTML or a playlist/);
const long = await run('media-duration-refused', { fileName: 'long.wav', format: 'mp3' }, false);
assert.match(long.result.error ?? '', /at most 120 seconds/);
const motion = await run('hyperframes-motion', { fileName: 'motion.html', format: 'hyperframes' });
assert.ok(motion.body.length > 100);
const motionProbe = JSON.parse((await mediaTool('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', '/fixtures/hyperframes-motion/output/artifact.mp4'])).stdout);
assert.ok(motionProbe.streams.some((stream: { codec_type: string }) => stream.codec_type === 'audio'), 'Authored local audio is mixed into the video');
assert.equal(motionProbe.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video').nb_frames, '12');
const hashes = (await mediaTool('ffmpeg', ['-v', 'error', '-threads', '1', '-i', '/fixtures/hyperframes-motion/output/artifact.mp4', '-map', '0:v:0', '-f', 'framemd5', '-'])).stdout.split('\n').filter((line) => line && !line.startsWith('#'));
assert.equal(hashes.length, 12); assert.notEqual(hashes[0]?.split(',').at(-1)?.trim(), hashes.at(-1)?.split(',').at(-1)?.trim(), 'Seeking must produce different first and last frames');
const dashboard = { fileName: 'dashboard-template.html', dataFile: 'dashboard-data.json' };
const dashboardHtml = await run('dashboard-html', { ...dashboard, format: 'html' });
assert.match(dashboardHtml.body.toString(), /Snapshot dashboard/); assert.match(dashboardHtml.body.toString(), /Revenue/); assert.match(dashboardHtml.body.toString(), /125/);
assert.doesNotMatch(dashboardHtml.body.toString(), /<script>UNTRUSTED_DATA/); assert.match(dashboardHtml.body.toString(), /&lt;script&gt;UNTRUSTED_DATA/);
const dashboardPdf = await run('dashboard-pdf', { ...dashboard, format: 'pdf' }); assert.equal(dashboardPdf.body.subarray(0, 4).toString(), '%PDF');
const dashboardImage = await run('dashboard-image', { ...dashboard, format: 'image', width: 800, height: 600 }); assert.equal(dashboardImage.body.subarray(1, 4).toString(), 'PNG');
await run('dashboard-array-refused', { ...dashboard, dataFile: 'dashboard-array.json', format: 'html' }, false);
await run('dashboard-script-refused', { ...dashboard, fileName: 'dashboard-script.html', format: 'html' }, false);
const dashboardPptx = await run('dashboard-deck-pptx', { ...dashboard, fileName: 'dashboard-deck.html', format: 'pptx', width: 800, height: 450 }); assert.equal(dashboardPptx.result.pages, 2); assert.equal(dashboardPptx.body.subarray(0, 2).toString(), 'PK');
const activeData = await run('dashboard-active-url-refused', { fileName: 'dashboard-link.html', dataFile: 'dashboard-link-data.json', format: 'html' }, false); assert.match(activeData.result.error ?? '', /Active URL/);

// Document outputs must contain editable semantics, not an image in a renamed archive.
await writeFile(path.join(source, 'report.md'), '# Document export fixture\n\nEditable **bold** text.\n\n| Metric | Value |\n| --- | ---: |\n| Customers | 24 |\n\n- [x] Complete\n- [ ] Pending\n\n```js\nconst count = 24;\n```\n');
const word = await run('document-word', { fileName: 'report.md', format: 'docx', title: 'Document export fixture' });
const wordZip = await JSZip.loadAsync(word.body);
const wordXml = await wordZip.file('word/document.xml').async('string');
assert.match(wordXml, /<w:tbl>/); assert.match(wordXml, /<w:b\s*\/>/);
assert.match(wordXml, /Customers/); assert.match(wordXml, /☒ Complete/); assert.match(wordXml, /☐ Pending/);
assert.equal((wordXml.match(/>Document export fixture<\/w:t>/g) ?? []).length, 1, 'Do not duplicate the visible H1 with HTML title metadata');
assert.ok(!wordXml.includes('<w:drawing'), 'Document text/table must not become a page screenshot');
const wordStyles = await wordZip.file('word/styles.xml').async('string'); assert.match(wordStyles, /Georgia/); assert.match(wordStyles, /Arial/);
const plainMarkdown = await run('document-markdown', { fileName: 'report.md', format: 'markdown' });
assert.equal(plainMarkdown.body.toString(), await readFile(path.join(source, 'report.md'), 'utf8'));
const documentPdf = await run('document-pdf', { fileName: 'report.md', format: 'pdf' }); assert.equal(documentPdf.body.subarray(0, 4).toString(), '%PDF');
await writeFile(path.join(source, 'active-document.html'), '<html data-eve-document="1"><body><iframe src="file:///job/input.json"></iframe></body></html>');
await run('document-active-refused', { fileName: 'active-document.html', format: 'docx' }, false);
await writeFile(path.join(source, 'illustrated.md'), '# Illustrated document\n\n![Local figure](asset.svg)\n');
const illustratedWord = await run('document-word-image', { fileName: 'illustrated.md', format: 'docx' });
const illustratedZip = await JSZip.loadAsync(illustratedWord.body);
assert.ok(Object.keys(illustratedZip.files).some(name => name.startsWith('word/media/')), 'Word must contain the local image bytes');
assert.match(await illustratedZip.file('word/document.xml').async('string'), /<w:drawing>/);
// The editor preserves image attributes/identity with an inline HTML wrapper.
await writeFile(path.join(source, 'editor-image.md'), '# Editor image\n\nBefore image.\n\n<span data-eve-document-image="1"><img src="asset.svg" alt="Editor figure" width="200" height="100"></span>\n');
const editorImageWord = await run('document-editor-image', { fileName: 'editor-image.md', format: 'docx' });
const editorImageZip = await JSZip.loadAsync(editorImageWord.body);
assert.ok(Object.keys(editorImageZip.files).some(name => name.startsWith('word/media/')), 'Editor-authored image bytes must remain in Word');
assert.match(await editorImageZip.file('word/document.xml').async('string'), /<w:drawing>/);
await writeFile(path.join(source, 'remote-document.md'), '# Remote document\n\n![Remote figure](https://unavailable.fixture.invalid/image.png)\n');
await run('document-remote-image-refused', { fileName: 'remote-document.md', format: 'docx' }, false);

process.stdout.write(`Contained export checks passed. Inspect artifacts in ${scratch}\n`);
