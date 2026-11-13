// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { documentHtml, documentImport, isEditableDocument, preserveDocumentRootAttributes } from '../../../src/components/embedded/document/document-html';
describe('semantic document import', () => {
  it('retains headings, lists, tables, inline emphasis and safe alignment', () => {
    const doc = documentImport('<h1>Report</h1><p style="text-align:center"><strong>Ready</strong></p><ul><li>One</li></ul><table><tr><td colspan="2">125</td></tr></table>');
    expect(doc.querySelector('h1')?.textContent).toBe('Report');
    expect(doc.querySelector('p')?.style.textAlign).toBe('center');
    expect(doc.querySelector('strong')?.textContent).toBe('Ready');
    expect(doc.querySelector('li')?.textContent).toBe('One');
    expect(doc.querySelector('td')?.getAttribute('colspan')).toBe('2');
  });
  it('does not admit scripts, frame content, event handlers, network styles or application overlays', () => {
    const doc = documentImport('<script>alert(1)</script><iframe src="/api/secrets"></iframe><img src="https://outside.test/x"><p onclick="alert(1)" style="position:fixed;inset:0;background:url(https://outside.test/x);text-align:right">Safe</p><a href="javascript:alert(1)">Bad</a>');
    expect(doc.querySelector('script,iframe,img,[onclick]')).toBeNull();
    expect(doc.querySelector('p')?.getAttribute('style')).toBe('text-align: right;');
    expect(doc.querySelector('a')?.hasAttribute('href')).toBe(false);
  });
  it('marks exported documents without interpreting the title as markup', () => {
    const html = documentHtml('<img onerror=alert(1)>', '<h1>Title</h1><p>Body</p>');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.title).toBe('<img onerror=alert(1)>');
    expect(doc.querySelector('img')).toBeNull();
    expect(isEditableDocument(html)).toBe(true);
    expect(isEditableDocument('<p>Legacy layout</p>')).toBe(false);
  });
});

it('preserves root metadata at the real HTML tag and escapes attribute values', () => {
  const html='<!-- <html fake> --><!doctype html><html data-eve-document="1"><head><script>const example="<html>";</script></head><body>Keep</body></html>';
  const changed=preserveDocumentRootAttributes(html,{lang:'en" data-injected="yes',dir:'rtl'});
  expect(changed).toBe(html.replace('<html data-eve-document="1">','<html data-eve-document="1" lang="en&quot; data-injected=&quot;yes" dir="rtl">'));
  const parsed=new DOMParser().parseFromString(changed,'text/html');
  expect(parsed.documentElement.hasAttribute('data-injected')).toBe(false);
  expect(parsed.documentElement.getAttribute('dir')).toBe('rtl');
});

it('retains independent heading families across every supported heading level in standalone output', () => {
  const html = documentHtml('Report', '<h1>One</h1><h2>Two</h2><h3>Three</h3><h4>Four</h4><h5>Five</h5><h6>Six</h6><p>Body</p>', 'sans', 'serif');
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const style = document.createElement('style'); style.textContent = parsed.querySelector('style')!.textContent;
  const content = document.createElement('div'); content.innerHTML = parsed.body.innerHTML;
  document.head.append(style); document.body.append(content);
  try {
    for (const heading of content.querySelectorAll('h1,h2,h3,h4,h5,h6')) expect(getComputedStyle(heading).fontFamily).toContain('Georgia');
    expect(getComputedStyle(content.querySelector('p')!).fontFamily).not.toContain('Georgia');
  } finally { style.remove(); content.remove(); }
});
