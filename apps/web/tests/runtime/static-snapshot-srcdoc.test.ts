// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildSrcdoc } from '../../src/runtime/srcdoc';
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
describe('frozen dashboard annotation sandbox', () => {
  it('admits only app-owned bridges and blocks source nonces, scripts and network access', () => {
    const source = '<!doctype html><html><head><meta http-equiv="refresh" content="0;url=/escape"><meta http-equiv="Content-Security-Policy" content="script-src *"><script nonce="forged">window.sourceCanary=1</script><script src="/untrusted.js"></script></head><body onload="window.eventCanary=1"><h1 data-od-id="total">42 founders</h1></body></html>';
    const doc = parse(buildSrcdoc(source, { staticSnapshot: true, selectionBridge: true, transportActivationGeneration: 'snapshot-test' }));
    const policy = doc.head.firstElementChild!;
    expect(policy.getAttribute('http-equiv')).toBe('Content-Security-Policy');
    expect(policy.getAttribute('content')).toContain("connect-src 'none'");
    expect(policy.getAttribute('content')).toMatch(/script-src 'nonce-[a-f0-9]+'/);
    expect(policy.getAttribute('content')).not.toContain("script-src 'unsafe-inline'");
    expect(doc.querySelector('[http-equiv="refresh"]')).toBeNull();
    const scripts = Array.from(doc.querySelectorAll('script'));
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.every(script => script.nonce !== 'forged' && !!script.nonce && !script.src)).toBe(true);
    expect(scripts.some(script => script.textContent?.includes('window.sourceCanary'))).toBe(false);
    expect(doc.querySelector('h1')?.textContent).toBe('42 founders');
    expect(scripts.some(script => script.textContent?.includes('od:comment-mode'))).toBe(true);
    expect(scripts.some(script => script.textContent?.includes('snapshot-test'))).toBe(true);
  });
  it('does not restrict ordinary authored HTML previews', () => {
    expect(buildSrcdoc('<script>window.sourceCanary=1</script>')).toContain('window.sourceCanary=1');
  });
  it('uses a new nonce per snapshot document', () => {
    const nonce = () => parse(buildSrcdoc('<h1>Snapshot</h1>', { staticSnapshot: true })).querySelector('script')!.nonce;
    expect(nonce()).not.toBe(nonce());
  });
});
