// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { documentColorLayoutQualified, validatedDocumentDateAtoms, type ValidatedDocumentDateAtoms } from '../src/browser.js';
const date = { iso: '2026-11-16', locale: 'en', label: 'Nov 16, 2026' };
const atom = '<time data-eve-document-date="1" datetime="2026-11-16" data-eve-date-locale="en">Nov 16, 2026</time>';
function source(body = `<p>${atom}</p>`) { document.documentElement.setAttribute('data-eve-document', '1'); document.head.innerHTML = ''; document.body.innerHTML = body; }
afterEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; document.documentElement.removeAttribute('data-eve-document'); });

it('requires exact native source matching and explicit opt-in; ordinary callers still refuse TIME', () => {
  source(); expect(documentColorLayoutQualified(document, [])).toBe(false);
  const dates = validatedDocumentDateAtoms(document, [date]);
  expect(dates.size).toBe(1); expect(documentColorLayoutQualified(document, [], dates)).toBe(true);
  expect(() => validatedDocumentDateAtoms(document, [])).toThrow(/presentation changed/);
});
it.each([
  atom.replace('2026-11-16', '2026-02-30'), atom.replace('data-eve-document-date="1"', 'data-eve-document-date="2"'),
  atom.replace('data-eve-date-locale="en"', 'data-eve-date-locale="not_a_locale"'), atom.replace('<time ', '<time onclick="run()" '),
  atom.replace('>Nov 16, 2026<', '><b>Nov 16, 2026</b><'), atom.replace('data-eve-document-date="1" ', ''),
  atom.replace('time', 'span').replace('</time>', '</span>'), '<script>Nov 16, 2026</script>',
  `<svg xmlns="http://www.w3.org/2000/svg">${atom}</svg>`,
])('the shared checker itself refuses forged membership for a noncanonical Date: %s', malformed => {
  source(`<p>${malformed}</p>`);
  const candidate = document.querySelector('time,span,script,svg')!;
  const forged = new Set([candidate]) as unknown as ValidatedDocumentDateAtoms;
  expect(documentColorLayoutQualified(document, [], forged)).toBe(false);
});
it.each([`<pre>${atom}</pre>`, `<p><code>${atom}</code></p>`, atom])('refuses unsupported Date contexts despite explicit set membership: %s', body => {
  source(body); const node = document.querySelector('time')!;
  expect(documentColorLayoutQualified(document, [], new Set([node]))).toBe(false);
});
it.each([{ iso: '2026-11-17' }, { locale: 'en-US' }, { label: 'Changed' }])('binds current DOM Date values to the trusted source vector: %j', change => {
  source(); expect(() => validatedDocumentDateAtoms(document, [{ ...date, ...change }])).toThrow(/presentation changed/);
});
it('refuses missing/extra/reordered atoms and stale or foreign element membership', () => {
  const second = { iso: '2026-11-17', locale: 'en', label: 'Nov 17, 2026' };
  source(`<p>${atom}${atom.replaceAll('16', '17')}</p>`);
  expect(() => validatedDocumentDateAtoms(document, [date])).toThrow();
  expect(() => validatedDocumentDateAtoms(document, [second, date])).toThrow();
  const dates = validatedDocumentDateAtoms(document, [date, second]);
  document.querySelector('time')!.remove(); expect(documentColorLayoutQualified(document, [], dates)).toBe(false);
  const foreign = document.implementation.createHTMLDocument('Foreign'); foreign.body.innerHTML = `<p>${atom}</p>`;
  expect(documentColorLayoutQualified(document, [], new Set([foreign.querySelector('time')!]))).toBe(false);
});
it('rechecks canonical shape on every policy call instead of trusting a stale set', () => {
  source(); const dates = validatedDocumentDateAtoms(document, [date]);
  document.querySelector('time')!.setAttribute('style', 'color:red');
  expect(documentColorLayoutQualified(document, [], dates)).toBe(false);
  expect(() => validatedDocumentDateAtoms(document, [date])).toThrow();
});
it('refuses a canonical but source-mismatched DOM value at the adapter boundary', () => {
  source(); validatedDocumentDateAtoms(document, [date]);
  document.querySelector('time')!.setAttribute('datetime', '2026-11-17');
  expect(() => validatedDocumentDateAtoms(document, [date])).toThrow(/presentation changed/);
});
it('does not turn Date membership into authored-CSS or legacy-TIME acceptance', () => {
  source(); const dates = validatedDocumentDateAtoms(document, [date]);
  document.head.innerHTML = '<style>.authored { color: red }</style>';
  expect(documentColorLayoutQualified(document, [], dates)).toBe(false);
  document.head.innerHTML = ''; document.body.insertAdjacentHTML('beforeend', '<p><time datetime="2026-11-16">Legacy</time></p>');
  expect(documentColorLayoutQualified(document, [], dates)).toBe(false);
});
