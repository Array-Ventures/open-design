import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { buildPreviewBaseHrefBridge } from '@open-design/contracts/runtime/preview-observability';
const project = '18a8301a-b6e1-4001-8000-c967b1eab222';
const path = (grant: string, id = project) => `http://preview.test/api/studio/preview/${grant}/${id}/projects/${id}/preview/daemon-scope/`;
describe('host preview capability rotation', () => {
  it('updates the live asset base only for a same-origin, same-project parent message', () => {
    const dom = new JSDOM(`<base data-od-project-preview-base href="${path('first')}"><body></body>`, { url: 'http://preview.test/', runScripts: 'outside-only' });
    try {
      const win = dom.window;
      win.eval(buildPreviewBaseHrefBridge().replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''));
      const send = (href: string, source: Window | null = win as unknown as Window) => win.dispatchEvent(new win.MessageEvent('message', { source, data: { type: 'od:preview-base-update', href } }));
      const base = win.document.querySelector('base')!;
      send(path('second'));
      expect(base.href).toBe(path('second'));
      send(path('other-project', '18a8301a-b6e1-4001-8000-c967b1eab999'));
      send(path('outside').replace('preview.test', 'outside.invalid'));
      send(path('untrusted'), null);
      expect(base.href).toBe(path('second'));
    } finally { dom.window.close(); }
  });
});
