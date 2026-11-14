// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { normalizeDocumentPresentationOwners } from '../src/browser.js';
const attribute = 'data-eve-docx-color-fixture';
const css = 'body{color:black;background:white}h1,h2,h3,h4,h5,h6{margin-top:24px}main>:first-child{margin-top:0}';
function source(body: string) {
  document.documentElement.setAttribute('data-eve-document','1');
  document.head.innerHTML = `<style>${css}</style>`; document.body.innerHTML = body;
}
const normalize = () => normalizeDocumentPresentationOwners(document,[{id:'heading',kind:'heading'}],attribute,[css],()=>[255,255,255,1]);
afterEach(() => { document.head.replaceChildren(); document.body.replaceChildren(); document.documentElement.removeAttribute('data-eve-document'); });
it.each(['Title','  <em>Title</em> ','<img src="pixel.png" width="24" height="24" alt="Owned image">'])('owns the actual first heading independently of its text shape: %s', content => {
  source(`<main><h1 ${attribute}="heading">${content}</h1><p>Body</p></main>`);
  expect(normalize()).toEqual([{id:'heading',presentation:{headingLevel:1,headingBeforePt:0,headingSource:'canonical-first-block'}}]);
});
it('does not assign first-block geometry to later headings or unknown document wrappers', () => {
  for (const body of [
    `<main><p>Earlier</p><h1 ${attribute}="heading">Later</h1></main>`,
    `<div><h1 ${attribute}="heading">Unknown wrapper</h1></div>`,
    `<main><h1 ${attribute}="heading">Title</h1></main><p>Outside canonical frame</p>`,
  ]) { source(body); expect(normalize()).toEqual([{id:'heading',presentation:{}}]); }
});
