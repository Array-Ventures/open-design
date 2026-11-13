// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyManualEditPatch } from '../../src/edit-mode/source-patches';
import { insertionImageSourceAllowed, type ManualEditInsertion, type ManualEditInsertionPatch } from '../../src/edit-mode/insertion';
import type { ManualEditPatch } from '../../src/edit-mode/types';
const source = '<!doctype html><html><head><style>.original{color:purple}</style></head><body><section data-od-id="slide" style="position:relative"><h1 data-od-id="heading">Retained heading</h1><p>Supporting content.</p></section><script>const original = "<keep>";</script></body></html>';
const parse = (value: string) => new DOMParser().parseFromString(value, 'text/html');
const id = 'eve-246109ab-8f8b-422b-b088-1260d39478d4';
function patch(element: ManualEditInsertion, placement = true): ManualEditInsertionPatch {
  return { kind: 'insert-element', id, parentId: 'slide', element, ...(placement ? { placement: { left: 32, top: 64, width: 240, height: 96 } } : {}) };
}
describe('typed source insertion', () => {
  it('adds literal editable text without rewriting existing content or adding executable markup', () => {
    const result = applyManualEditPatch(source, patch({ kind: 'text', text: '<img src=x onerror=alert(1)>\nNew text' }));
    expect(result.ok).toBe(true); const doc = parse(result.source), inserted = doc.querySelector(`[data-od-id="${id}"]`) as HTMLElement;
    expect(inserted.textContent).toBe('<img src=x onerror=alert(1)>\nNew text'); expect(inserted.children).toHaveLength(0);
    expect(inserted.style.position).toBe('absolute'); expect(inserted.style.left).toBe('32px'); expect(inserted.style.height).toBe('96px');
    expect(doc.querySelector('[data-od-id="heading"]')?.outerHTML).toBe(parse(source).querySelector('h1')?.outerHTML);
    expect(doc.querySelector('style')?.textContent).toBe('.original{color:purple}'); expect(doc.querySelector('script')?.textContent).toBe('const original = "<keep>";');
    expect(doc.querySelectorAll('script')).toHaveLength(1); expect(doc.querySelectorAll('img')).toHaveLength(0);
  });
  it('builds a genuine bounded semantic table with independently editable cell text', () => {
    const result = applyManualEditPatch(source, patch({ kind: 'table', rows: 3, columns: 2 }));
    const doc = parse(result.source), table = doc.querySelector('table')!;
    expect(result.ok).toBe(true); expect(table.rows).toHaveLength(3); expect(table.querySelectorAll('th')).toHaveLength(2); expect(table.querySelectorAll('td')).toHaveLength(4);
    expect(table.querySelector('th')?.getAttribute('scope')).toBe('col'); expect(table.style.borderCollapse).toBe('collapse');
    expect(doc.querySelector('[data-od-id="heading"]')?.textContent).toBe('Retained heading');
  });
  it.each(['rectangle', 'ellipse', 'triangle', 'line', 'arrow'] as const)('creates a visible %s with no external resource or script', shape => {
    const result = applyManualEditPatch(source, patch({ kind: 'shape', shape }, false)); const doc = parse(result.source);
    const node = doc.querySelector(`[data-od-id="${id}"]`) as HTMLElement;
    expect(result.ok).toBe(true); expect(node.style.width).toBe('160px'); expect(node.style.height).not.toBe('0px'); expect(node.getAttribute('role')).toBe('img');
    expect(doc.querySelectorAll('script')).toHaveLength(1); expect(node.querySelectorAll('script,image,foreignObject')).toHaveLength(0);
    if (shape === 'ellipse') expect(node.style.borderRadius).toBe('50%');
    if (shape === 'arrow') expect(node.querySelector('line')?.getAttribute('marker-end')).toBe(`url(#${id}-tip)`);
  });
  it('preserves directional arrow endpoints inside the dragged bounds', () => {
    const request = patch({ kind: 'shape', shape: 'arrow' }); request.placement!.flipX = true;
    const line = parse(applyManualEditPatch(source, request).source).querySelector('line')!;
    expect(line.getAttribute('x1')).toBe('100'); expect(line.getAttribute('x2')).toBe('0'); expect(line.getAttribute('y1')).toBe('0'); expect(line.getAttribute('y2')).toBe('100');
  });
  it('replays an exact identity without another object, but refuses a changed payload or parent', () => {
    const request = patch({ kind: 'text', text: 'Insert once' }), first = applyManualEditPatch(source, request);
    const again = applyManualEditPatch(first.source, request);
    expect(again).toEqual({ ok: true, source: first.source, unchanged: true }); expect(parse(again.source).querySelectorAll(`[data-od-id="${id}"]`)).toHaveLength(1);
    expect(applyManualEditPatch(first.source, { ...request, element: { kind: 'text', text: 'Different intent' } }).ok).toBe(false);
    expect(applyManualEditPatch(first.source, { ...request, parentId: '__body__' }).ok).toBe(false);
  });
  it('can edit and remove the inserted source object through the existing patch path', () => {
    const created = applyManualEditPatch(source, patch({ kind: 'text', text: 'Editable' }));
    const changed = applyManualEditPatch(created.source, { kind: 'set-text', id, value: 'Edited object' });
    expect(parse(changed.source).querySelector(`[data-od-id="${id}"]`)?.textContent).toBe('Edited object');
    const removed = applyManualEditPatch(changed.source, { kind: 'remove-element', id }); expect(removed.ok).toBe(true);
    expect(parse(removed.source).querySelector(`[data-od-id="${id}"]`)).toBeNull(); expect(parse(removed.source).querySelector('h1')?.textContent).toBe('Retained heading');
  });
  it('does not nest a new object inside an existing text box or shape', () => {
    const text = applyManualEditPatch(source, patch({kind:'text',text:'Existing box'}));
    const next = {...patch({kind:'table',rows:2,columns:2}),id:'eve-246109ab-8f8b-422b-b088-1260d39478d5',parentId:id};
    expect(applyManualEditPatch(text.source,next)).toMatchObject({ok:false,source:text.source});
    const shape = applyManualEditPatch(source,patch({kind:'shape',shape:'rectangle'}));
    expect(applyManualEditPatch(shape.source,next)).toMatchObject({ok:false,source:shape.source});
  });
  it('supports fragments and an explicit body target without wrapping a fragment in html', () => {
    const result = applyManualEditPatch('<main>Original</main>', { ...patch({ kind: 'text', text: 'Flow text' }, false), parentId: '__body__' });
    expect(result.ok).toBe(true); expect(result.source).not.toContain('<html'); expect(parse(result.source).body.children).toHaveLength(2);
  });
  it.each([
    { parentId: 'missing' }, { parentId: 'heading' }, { parentId: '"bad[' }, { id: 'path-0' },
    { placement: { left: -1, top: 0, width: 20, height: 20 } }, { placement: { left: 0, top: NaN, width: 20, height: 20 } },
    { placement: { left: 0, top: 0, width: Infinity, height: 20 } }, { placement: { left: 0, top: 0, width: 20, height: 0 } },
    { element: { kind: 'text', text: '' } }, { element: { kind: 'table', rows: 21, columns: 2 } }, { element: { kind: 'table', rows: 2, columns: 13 } },
    { element: { kind: 'shape', shape: 'script' } }, { element: { kind: 'text', text: 'Text', onclick: 'alert(1)' } },
  ])('rejects malformed insertion without changing source: %j', override => {
    const result = applyManualEditPatch(source, { ...patch({ kind: 'text', text: 'Text' }), ...override } as ManualEditPatch);
    expect(result.ok).toBe(false); expect(result.source).toBe(source);
  });
});
describe('project image insertion', () => {
  it('keeps nested assets and ordinary encoded filenames inside the owning project', () => {
    expect(insertionImageSourceAllowed('../images/my photo.png', 'slides/index.html')).toBe(true);
    expect(insertionImageSourceAllowed('../images/my%20photo.png', 'slides/index.html')).toBe(true);
    expect(insertionImageSourceAllowed('./image.png')).toBe(true);
    expect(insertionImageSourceAllowed('photo.png', 'slides/index.html', '../images/')).toBe(true);
    const result = applyManualEditPatch(source, patch({ kind: 'image', src: '../images/my photo.png', alt: 'Literal "alt" <text>' }), 'slides/index.html');
    const image = parse(result.source).querySelector('img')!; expect(result.ok).toBe(true); expect(image.getAttribute('src')).toBe('../images/my photo.png'); expect(image.alt).toBe('Literal "alt" <text>'); expect(image.hasAttribute('onerror')).toBe(false);
  });
  it.each(['../../outside.png', 'https://example.test/a.png', '//example.test/a.png', '/other.png', 'data:image/svg+xml,x', 'javascript:alert(1)', 'image.png?token=x', 'image.png#x', '.eve/private.png', '.env/x.png', 'images%2foutside.png', '%252e%252e/out.png', 'a\\image.png', 'a\n.png', 'file.html'])('rejects outside or ambiguous image source %s', src => {
    const result = applyManualEditPatch(source, patch({ kind: 'image', src, alt: '' })); expect(result.ok).toBe(false); expect(result.source).toBe(source);
  });
  it('refuses a base that would move an uploaded image outside its project', () => {
    expect(insertionImageSourceAllowed('image.png', 'index.html', 'https://external.test/')).toBe(false);
    expect(insertionImageSourceAllowed('image.png', 'index.html', '../')).toBe(false);
    expect(insertionImageSourceAllowed('image.png', '../outside.html')).toBe(false);
  });
});
