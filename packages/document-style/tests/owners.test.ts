// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { documentColorLayoutQualified, normalizeDocumentColorOwners, repairDocumentPrintInk, type DocumentColorReader } from '../src/browser.js';
const attribute = 'data-eve-docx-color-fixture';
// Deliberately supplied color-reader port; real Chromium separately qualifies
// Canvas/modern colors. CSSOM still supplies the fixture's actual ancestry.
const read: DocumentColorReader = value => {
  if (['canvas','rgb(255, 255, 255)','white'].includes(value)) return [255,255,255,1];
  if (['canvastext','rgb(0, 0, 0)','black'].includes(value)) return [0,0,0,1];
  const rgb = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/.exec(value);
  return rgb ? [Number(rgb[1]),Number(rgb[2]),Number(rgb[3]),rgb[4] ? Number(rgb[4]) : 1] : null;
};
const style = 'body{color:CanvasText}';
function source(body: string, css = style) { document.documentElement.setAttribute('data-eve-document','1'); document.head.innerHTML = `<style>${css}</style>`; document.body.innerHTML = body; }
beforeEach(() => vi.stubGlobal('CSS', { supports: (_property: string, value: string) => { const probe = document.createElement('span').style; probe.color = value; return !!probe.color; } }));
afterEach(() => { document.head.replaceChildren(); document.body.replaceChildren(); document.documentElement.removeAttribute('data-eve-document'); vi.unstubAllGlobals(); });
it('normalizes shorthand, contextual alpha, nested backgrounds and explicit foreground while deriving ink only on text owners', () => {
  source(`<table><tr><td ${attribute}="cell" style="background:rgb(24,24,40)"><span ${attribute}="direct">Implicit dark ink</span><span style="background-color:rgb(255,246,170)"><span ${attribute}="nested">Nested light</span></span><span style="color:rgba(255,0,0,.5)"><span ${attribute}="authored">Authored alpha</span></span></td></tr></table>`);
  const result = normalizeDocumentColorOwners(document, [{id:'cell',kind:'cell'},{id:'direct',kind:'inline'},{id:'nested',kind:'inline'},{id:'authored',kind:'inline'}], attribute, [style], read);
  expect(result).toEqual([
    {id:'cell',colors:{background:'181828'}},
    {id:'direct',colors:{foreground:'FFFFFF',foregroundSource:'inherited'}},
    {id:'nested',colors:{background:'FFF6AA'}},
    {id:'authored',colors:{foreground:'8C0C14',foregroundSource:'authored'}},
  ]);
});
it('requires every staged owner exactly once and never calls unresolved authored ink empty', () => {
  source(`<p><span ${attribute}="owner" style="color:rgba(1,2,3,.5)">Alpha</span></p>`);
  expect(() => normalizeDocumentColorOwners(document,[{id:'missing',kind:'inline'}],attribute,[style],read)).toThrow();
  expect(() => normalizeDocumentColorOwners(document,[{id:'owner',kind:'inline'}],attribute,[style],()=>null)).toThrow();
  document.body.innerHTML += `<span ${attribute}="owner">Duplicate</span>`;
  expect(() => normalizeDocumentColorOwners(document,[{id:'owner',kind:'inline'}],attribute,[style],read)).toThrow();
});
it('declines unknown selectors/layout for print without adding wrappers and refuses Word normalization', () => {
  source(`<p><span ${attribute}="owner">Authored layout</span></p>`, 'p:has(span){display:flex;color:red}');
  const before = document.documentElement.outerHTML;
  expect(repairDocumentPrintInk(document,[style],read)).toEqual({applied:0,qualified:false});
  expect(document.documentElement.outerHTML).toBe(before);
  expect(() => normalizeDocumentColorOwners(document,[{id:'owner',kind:'inline'}],attribute,[style],read)).toThrow();
});
it('admits only the safe prepared checklist representation and preserves semantic superscripts', () => {
  source('<ul><li><label><input type="checkbox" disabled checked><span>Checked</span></label></li></ul><p><sup><u><span lang="fr-FR">raised</span></u></sup></p>');
  expect(documentColorLayoutQualified(document,[style])).toBe(true);
  document.querySelector('input')!.removeAttribute('disabled'); expect(documentColorLayoutQualified(document,[style])).toBe(false);
});
it('wraps only deficient unowned text and keeps nested/background and explicit author ink unchanged', () => {
  source('<table><tr><td style="background-color:rgb(24,24,40)">Unowned <span style="background-color:rgb(255,246,170)">Nested light</span><span style="color:rgb(127,29,29)">Authored</span></td></tr></table>');
  const result = repairDocumentPrintInk(document,[style],read);
  expect(result).toEqual({applied:1,qualified:true});
  expect(document.querySelector('td')!.style.color).toBe('');
  expect(document.querySelector<HTMLElement>('td > span')!.style.color).toBe('white');
  expect(document.querySelector('[style*="127"]')!.textContent).toBe('Authored');
  expect(document.querySelector('[style*="background-color:rgb(255"]')!.textContent).toBe('Nested light');
});

it('composites an authored alpha cell background over an explicit canvas', () => {
  source(`<table><tr><td ${attribute}="cell" style="background-color:rgba(0,0,0,.5)">Alpha background</td></tr></table>`);
  // This injected reader represents exact .5 alpha. The real Canvas reader's
  // 8-bit alpha and opaque output are separately checked in Chromium.
  expect(normalizeDocumentColorOwners(document,[{id:'cell',kind:'cell'}],attribute,[style],read)).toEqual([{id:'cell',colors:{background:'808080'}}]);
});
it('refuses a quoted semicolon declaration instead of silently dropping an authored font', () => {
  source(`<p><span ${attribute}="font" style='font-family:"semi;colon"'>Font</span></p>`);
  const before = document.body.innerHTML;
  expect(() => normalizeDocumentColorOwners(document,[{id:'font',kind:'inline'}],attribute,[style],read)).toThrow();
  expect(repairDocumentPrintInk(document,[style],read)).toEqual({applied:0,qualified:false}); expect(document.body.innerHTML).toBe(before);
});
it('proves collapsed indentation empty but retains visible highlighted whitespace and refuses padded paint', () => {
  source(`<table><tr><td style="background-color:rgb(24,24,40)"><span ${attribute}="indent">\n </span><span style="background-color:rgb(255,246,170);white-space:pre-wrap"><span ${attribute}="visible"> </span></span></td></tr></table>`);
  vi.spyOn(document,'createRange').mockImplementation(() => {
    let visible = false;
    return { selectNodeContents(node: Node) { visible = (node as Element).getAttribute(attribute) === 'visible'; }, getClientRects() { return visible ? [{width:4,height:16}] : []; } } as unknown as Range;
  });
  expect(normalizeDocumentColorOwners(document,[{id:'indent',kind:'inline'},{id:'visible',kind:'inline'}],attribute,[style],read)).toEqual([{id:'indent',colors:{}},{id:'visible',colors:{background:'FFF6AA'}}]);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) { return {width:this.style.backgroundColor ? 40 : 0,height:16} as DOMRect; });
  source(`<p><span style="background-color:rgb(255,246,170)"><span ${attribute}="painted"> </span></span></p>`);
  expect(() => normalizeDocumentColorOwners(document,[{id:'painted',kind:'inline'}],attribute,[style],read)).toThrow();
  vi.restoreAllMocks();
  source(`<p><span style="background-color:rgb(255,246,170);padding-inline-start:40px"><span ${attribute}="padded"> </span></span></p>`);
  expect(() => normalizeDocumentColorOwners(document,[{id:'padded',kind:'inline'}],attribute,[style],read)).toThrow();
});
