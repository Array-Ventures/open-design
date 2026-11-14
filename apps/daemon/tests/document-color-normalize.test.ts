import { beforeEach, expect, it, vi } from 'vitest';
import type { Page } from 'playwright-core';

const mock = vi.hoisted(() => ({ launch: vi.fn(), read: vi.fn() }));
vi.mock('playwright-core', () => ({ chromium: { launch: mock.launch } }));
vi.mock('node:fs/promises', async original => ({ ...await original<object>(), readFile: mock.read }));
import { normalizeDocumentDocxColors, repairDocumentPdfColors } from '../src/embedded-render/document-color-normalize.js';
import { MAX_STANDALONE_OUTPUT_BYTES } from '../src/artifacts/standalone-html.js';

const html = '<html data-eve-document="1"><body><p>Owned document</p></body></html>';
const requests = [{ id: 'text', kind: 'inline' as const }];
const attribute = 'data-eve-docx-color-fixture';
let qualified = true;
let result: unknown, routeRequest: string | undefined, projectError: Error | undefined;
let events: string[], route: ((value: unknown) => Promise<void>) | undefined;
const close = vi.fn(), proceed = vi.fn(), abort = vi.fn();
const page = {
  route: vi.fn(async (_pattern: string, handler: (value: unknown) => Promise<void>) => { route = handler; }),
  on: vi.fn(),
  emulateMedia: vi.fn(async () => { events.push('print'); }),
  setContent: vi.fn(async () => {
    events.push('content');
    if (routeRequest) await route!({ request: () => ({ url: () => routeRequest }), continue: proceed, abort });
  }),
  addStyleTag: vi.fn(async () => { events.push('divider-style'); }),
  addScriptTag: vi.fn(async () => { events.push('bundle'); }),
  evaluate: vi.fn(async (script: string) => {
    if (script.startsWith('Promise.all(')) { events.push('assets'); return; }
    if (script.startsWith('globalThis.odDocumentColor.documentColorLayoutQualified')) { events.push('qualification'); return qualified; }
    events.push('projection');
    if (projectError) throw projectError;
    return result;
  }),
};
beforeEach(() => {
  vi.clearAllMocks(); qualified = true; events = []; route = undefined; routeRequest = undefined; projectError = undefined;
  result = [{ id: 'text', presentation: { foreground: 'FFFFFF', foregroundSource: 'inherited' } }];
  mock.read.mockResolvedValue('/* owned color closure */');
  mock.launch.mockResolvedValue({ newPage: vi.fn().mockResolvedValue(page), close });
});

it.each(['<script>throw 1</script>', '<iframe src="data:text/html,unsafe"></iframe>', '<p onclick="unsafe()">Text</p>', '<div srcdoc="unsafe"></div>', '<canvas></canvas>'])('refuses executable source before starting a browser: %s', async body => {
  await expect(normalizeDocumentDocxColors(`<html><body>${body}</body></html>`, requests, attribute)).rejects.toThrow();
  expect(mock.launch).not.toHaveBeenCalled(); expect(mock.read).not.toHaveBeenCalled();
});
it('refuses oversized source before starting a browser', async () => {
  // This boundary receives already-bundled images/styles, so its established
  // standalone output cap applies rather than the smaller raw-document cap.
  await expect(normalizeDocumentDocxColors('x'.repeat(MAX_STANDALONE_OUTPUT_BYTES + 1), requests, attribute)).rejects.toThrow('standalone export byte limit');
  expect(mock.launch).not.toHaveBeenCalled();
});
it('does not impose a new ten-megabyte limit on valid bundled documents', async () => {
  await normalizeDocumentDocxColors(`<html data-eve-document="1"><body>${'x'.repeat(10 * 1024 * 1024 + 1)}</body></html>`, requests, attribute);
  expect(close).toHaveBeenCalledTimes(1);
});
it('resolves exact owners after print media and assets, then closes its browser', async () => {
  const resolved = await normalizeDocumentDocxColors(html, requests, attribute);
  expect([...resolved]).toEqual([['text', { foreground: 'FFFFFF', foregroundSource: 'inherited' }]]);
  expect(events).toEqual(['print', 'content', 'divider-style', 'assets', 'bundle', 'projection']);
  expect(page.emulateMedia).toHaveBeenCalledWith({ media: 'print' });
  expect(mock.read).toHaveBeenCalledWith('/opt/render/document-color.iife.js', 'utf8');
  expect(page.evaluate.mock.calls.at(-1)![0]).toContain(JSON.stringify(requests));
  expect(page.evaluate.mock.calls.at(-1)![0]).toContain(JSON.stringify(attribute));
  expect(close).toHaveBeenCalledTimes(1);
});
it.each(['https://outside.invalid/asset.png', 'http://127.0.0.1:9999/private', 'file:///private'])('blocks resource acquisition and refuses the conversion: %s', async url => {
  routeRequest = url;
  await expect(normalizeDocumentDocxColors(html, requests, attribute)).rejects.toThrow();
  expect(abort).toHaveBeenCalledWith('blockedbyclient'); expect(proceed).not.toHaveBeenCalled();
  expect(events).not.toContain('projection'); expect(close).toHaveBeenCalledTimes(1);
});
it.each(['data:image/png;base64,AA==', 'blob:null/owned'])('permits contained resources: %s', async url => {
  routeRequest = url;
  await normalizeDocumentDocxColors(html, requests, attribute);
  expect(proceed).toHaveBeenCalledTimes(1); expect(abort).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1);
});
it.each([
  null, {}, [], [{ id: 'wrong', presentation: {} }], [{ id: 'text', presentation: [] }],
  [{ id: 'text', presentation: { unknown: 'FFFFFF' } }],
  [{ id: 'text', presentation: { background: '#FFFFFF' } }],
  [{ id: 'text', presentation: { background: 'ffffff' } }],
  [{ id: 'text', presentation: { foreground: 'FFFFFF', foregroundSource: ['authored'] } }],
  [{ id: 'text', presentation: { foregroundSource: 'authored' } }],
  [{ id: 'text', presentation: { foreground: 'FFFFFF' } }],
])('refuses malformed or incomplete owner presentation: %j', async invalid => {
  result = invalid;
  await expect(normalizeDocumentDocxColors(html, requests, attribute)).rejects.toThrow();
  expect(close).toHaveBeenCalledTimes(1);
});
it('refuses duplicate owners even when the result count matches', async () => {
  result = [{ id: 'text', presentation: {} }, { id: 'text', presentation: {} }];
  await expect(normalizeDocumentDocxColors(html, [...requests, { id: 'cell', kind: 'cell' }], attribute)).rejects.toThrow();
  expect(close).toHaveBeenCalledTimes(1);
});
it('preserves empty color descriptors for uncolored native owners', async () => {
  result = [{ id: 'text', presentation: {} }];
  expect([...(await normalizeDocumentDocxColors(html, requests, attribute))]).toEqual([['text', {}]]);
});
it('does not accept inherited text ink on a parent cell owner', async () => {
  result = [{ id: 'cell', presentation: { foreground: 'FFFFFF', foregroundSource: 'inherited' } }];
  await expect(normalizeDocumentDocxColors(html, [{ id: 'cell', kind: 'cell' }], attribute)).rejects.toThrow();
  expect(close).toHaveBeenCalledTimes(1);
});
it('closes a launched browser when creating its contained page fails', async () => {
  mock.launch.mockResolvedValue({ newPage: vi.fn().mockRejectedValue(new Error('No page')), close });
  await expect(normalizeDocumentDocxColors(html, requests, attribute)).rejects.toThrow('No page');
  expect(close).toHaveBeenCalledTimes(1); expect(mock.read).not.toHaveBeenCalled();
});
it('closes the browser when projection fails', async () => {
  projectError = new Error('Unrepresentable authored color');
  await expect(normalizeDocumentDocxColors(html, requests, attribute)).rejects.toThrow(projectError.message);
  expect(close).toHaveBeenCalledTimes(1);
});
it('closes the browser when the owned bundle is unavailable', async () => {
  mock.read.mockRejectedValue(new Error('Missing contained bundle'));
  await expect(normalizeDocumentDocxColors(html, requests, attribute)).rejects.toThrow('Missing contained bundle');
  expect(close).toHaveBeenCalledTimes(1); expect(events).not.toContain('projection');
});
it('repairs only the existing PDF page after print assets, without owning its lifecycle', async () => {
  await repairDocumentPdfColors(page as unknown as Page, html, ['owned-print-css']);
  expect(events).toEqual(['print', 'assets', 'bundle', 'qualification', 'divider-style', 'projection']);
  expect(page.evaluate.mock.calls.at(-1)![0]).toContain('repairDocumentPrintInk');
  expect(page.evaluate.mock.calls.at(-1)![0]).toContain('owned-print-css');
  expect(mock.launch).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
});

it('does not restyle an unqualified PDF document', async () => {
  qualified = false;
  await repairDocumentPdfColors(page as unknown as Page, html, ['owned-print-css']);
  expect(page.addStyleTag).not.toHaveBeenCalled();
  expect(events).toEqual(['print','assets','bundle','qualification','projection']);
});
it.each([
  {fontSizePt:30},
  {fontSizePt:30,fontLineHeightPt:45},
  {fontSizePt:30,fontLineHeightPt:45,fontSizeSource:'inherited'},
  {fontSizePt:'30',fontLineHeightPt:45,fontSizeSource:'authored'},
  {fontSizePt:NaN,fontLineHeightPt:45,fontSizeSource:'authored'},
  {fontSizePt:30,fontLineHeightPt:Infinity,fontSizeSource:'authored'},
  {fontSizePt:2000,fontLineHeightPt:45,fontSizeSource:'authored'},
])('rejects malformed or incomplete authored font provenance: %j', async presentation => {
  result = [{id:'text',presentation}];
  await expect(normalizeDocumentDocxColors(html,requests,attribute)).rejects.toThrow();
});
it('accepts only complete inline font ownership and rejects the old parallel descriptor key', async () => {
  result = [{id:'text',presentation:{fontSizePt:30,fontLineHeightPt:45,fontSizeSource:'authored'}}];
  expect(await normalizeDocumentDocxColors(html,requests,attribute)).toEqual(new Map([['text',{fontSizePt:30,fontLineHeightPt:45,fontSizeSource:'authored'}]]));
  for (const kind of ['cell','divider'] as const) await expect(normalizeDocumentDocxColors(html,[{id:'text',kind}],attribute)).rejects.toThrow();
  result = [{id:'text',colors:{foreground:'FFFFFF',foregroundSource:'authored'}}];
  await expect(normalizeDocumentDocxColors(html,requests,attribute)).rejects.toThrow();
});
it.each([
  {headingLevel:1,headingBeforePt:0},
  {headingLevel:0,headingBeforePt:0,headingSource:'canonical-first-block'},
  {headingLevel:7,headingBeforePt:0,headingSource:'canonical-first-block'},
  {headingLevel:1,headingBeforePt:18,headingSource:'canonical-first-block'},
  {headingLevel:1,headingBeforePt:0,headingSource:'claimed'},
  {headingLevel:1,headingBeforePt:0,headingSource:'canonical-first-block',foreground:'FFFFFF',foregroundSource:'authored'},
])('rejects malformed or mixed heading context: %j', async presentation => {
  result = [{id:'text',presentation}];
  await expect(normalizeDocumentDocxColors(html,[{id:'text',kind:'heading'}],attribute)).rejects.toThrow();
});
it('requires heading context on heading requests only, while keeping later heading descriptors empty', async () => {
  result = [{id:'text',presentation:{headingLevel:1,headingBeforePt:0,headingSource:'canonical-first-block'}}];
  await expect(normalizeDocumentDocxColors(html,requests,attribute)).rejects.toThrow();
  expect(await normalizeDocumentDocxColors(html,[{id:'text',kind:'heading'}],attribute)).toEqual(new Map([['text',{headingLevel:1,headingBeforePt:0,headingSource:'canonical-first-block'}]]));
  result = [{id:'text',presentation:{}}];
  expect(await normalizeDocumentDocxColors(html,[{id:'text',kind:'heading'}],attribute)).toEqual(new Map([['text',{}]]));
});
it('requires a complete finite image-line receipt on its source heading, independently of a first-heading margin receipt', async () => {
  const image = {headingLevel:1,headingImageLineHeightPt:37.5,headingImageWidthPt:18,headingImageHeightPt:18,headingImageSource:'single-baseline-image'};
  result = [{id:'text',presentation:image}];
  expect(await normalizeDocumentDocxColors(html,[{id:'text',kind:'heading'}],attribute)).toEqual(new Map([['text',image]]));
  await expect(normalizeDocumentDocxColors(html,requests,attribute)).rejects.toThrow();
  for (const invalid of [
    {...image,headingLevel:undefined},
    {...image,headingImageSource:undefined},
    {...image,headingImageLineHeightPt:NaN},
    {...image,headingImageHeightPt:38},
    {...image,headingImageWidthPt:Infinity},
    {...image,headingBeforePt:0},
  ]) {
    result = [{id:'text',presentation:invalid}];
    await expect(normalizeDocumentDocxColors(html,[{id:'text',kind:'heading'}],attribute)).rejects.toThrow();
  }
});
