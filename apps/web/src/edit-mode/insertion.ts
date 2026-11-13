import { z } from 'zod';

const coordinate = z.number().finite().min(0).max(100_000);
export const ManualEditInsertion = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().min(1).max(20_000) }).strict(),
  z.object({ kind: z.literal('image'), src: z.string().min(1).max(2000), alt: z.string().max(2000) }).strict(),
  z.object({ kind: z.literal('table'), rows: z.number().int().min(1).max(20), columns: z.number().int().min(1).max(12) }).strict(),
  z.object({ kind: z.literal('shape'), shape: z.enum(['rectangle', 'ellipse', 'triangle', 'line', 'arrow']) }).strict(),
]);
export type ManualEditInsertion = z.infer<typeof ManualEditInsertion>;
export const ManualEditInsertionPatch = z.object({
  kind: z.literal('insert-element'),
  id: z.string().regex(/^eve-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
  parentId: z.string().min(1).max(500),
  element: ManualEditInsertion,
  placement: z.object({ left: coordinate, top: coordinate, width: z.number().finite().min(1).max(4096), height: z.number().finite().min(1).max(4096), flipX: z.boolean().optional(), flipY: z.boolean().optional() }).strict().optional(),
}).strict();
export type ManualEditInsertionPatch = z.infer<typeof ManualEditInsertionPatch>;

export function insertionParentAllowed(parent: Element): boolean {
  return !['text', 'link', 'image'].includes(parent.getAttribute('data-od-edit') ?? '')
    && parent.getAttribute('role') !== 'img'
    && parent.namespaceURI === 'http://www.w3.org/1999/xhtml'
    && /^(body|main|section|article|div|header|footer|aside|nav|figure|figcaption|form|fieldset|details|li|td|th)$/.test(parent.localName);
}

/** Project-relative assets only: creation never starts a remote fetch or adds
 * an executable URL. Existing approved media upload resolves the asset name. */
export function insertionImageSourceAllowed(src: string, ownerFileName = 'index.html', authoredBase: string | null = null): boolean {
  try {
    const decoded = decodeURIComponent(src);
    if (decoded.includes('%') || authoredBase && /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(authoredBase.trim())) return false;
    if (src !== src.trim() || /[\\\u0000-\u001f\u007f?#]/.test(decoded) || /%(?:2f|5c)/i.test(src) || /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(decoded)) return false;
    const owner = ownerFileName.split('/');
    if (owner.some(part => !part || part === '.' || part === '..' || /[\\\u0000-\u001f?#]/.test(part))) return false;
    const root = 'https://project.invalid/__evebot_project__/';
    const ownerUrl = new URL(owner.map(encodeURIComponent).join('/'), root);
    const base = authoredBase ? new URL(authoredBase, ownerUrl) : ownerUrl;
    const target = new URL(src, base);
    if (!target.href.startsWith(root) || target.search || target.hash) return false;
    const parts = decodeURIComponent(target.pathname).split('/');
    if (parts.some(part => /^\.env(?:\.|$)/i.test(part) || ['.git', '.eve', '.file-versions', 'node_modules'].includes(part))) return false;
    return /\.(?:png|jpe?g|gif|webp|avif|svg)$/i.test(parts.at(-1) ?? '');
  } catch { return false; }
}

/** Create with DOM APIs so inserted labels/URLs cannot become markup. The
 * authored canvas inherits its own color/type; BoardUI styles only the chrome. */
export function createInsertedElement(doc: Document, patch: ManualEditInsertionPatch): Element {
  const content = patch.element;
  let element: HTMLElement | SVGSVGElement;
  if (content.kind === 'text') {
    element = doc.createElement('div'); element.textContent = content.text;
    element.setAttribute('data-od-edit', 'text'); element.style.whiteSpace = 'pre-wrap';
    element.style.fontFamily = 'inherit'; element.style.fontSize = 'inherit'; element.style.lineHeight = '1.3';
  } else if (content.kind === 'image') {
    const image = doc.createElement('img'); image.setAttribute('src', content.src); image.setAttribute('alt', content.alt);
    image.style.objectFit = 'contain'; element = image;
  } else if (content.kind === 'table') {
    const table = doc.createElement('table'); table.style.borderCollapse = 'collapse';
    const head = table.createTHead(), header = head.insertRow();
    for (let column = 0; column < content.columns; column++) { const cell = doc.createElement('th'); cell.scope = 'col'; cell.textContent = `Heading ${column + 1}`; header.append(cell); }
    const body = table.createTBody();
    for (let row = 1; row < content.rows; row++) { const line = body.insertRow(); for (let column = 0; column < content.columns; column++) line.insertCell().textContent = 'Text'; }
    for (const cell of table.querySelectorAll<HTMLElement>('th,td')) { cell.style.border = '1px solid currentColor'; cell.style.padding = '8px'; }
    element = table;
  } else if (content.shape === 'rectangle' || content.shape === 'ellipse') {
    element = doc.createElement('div'); element.style.border = '2px solid currentColor'; element.style.boxSizing = 'border-box';
    if (content.shape === 'ellipse') element.style.borderRadius = '50%';
    element.setAttribute('role', 'img'); element.setAttribute('aria-label', content.shape === 'ellipse' ? 'Ellipse' : 'Rectangle');
  } else {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', content.shape === 'triangle' ? 'Triangle' : content.shape === 'arrow' ? 'Arrow' : 'Line');
    svg.style.overflow = 'visible';
    if (content.shape === 'triangle') { const polygon = doc.createElementNS(ns, 'polygon'); polygon.setAttribute('points', '50,0 100,100 0,100'); polygon.setAttribute('fill', 'currentColor'); svg.append(polygon); }
    else {
      const line = doc.createElementNS(ns, 'line'), position = patch.placement;
      line.setAttribute('x1', position?.flipX ? '100' : '0'); line.setAttribute('x2', position?.flipX ? '0' : '100');
      line.setAttribute('y1', position?.flipY ? '100' : '0'); line.setAttribute('y2', position?.flipY ? '0' : '100');
      line.setAttribute('stroke', 'currentColor'); line.setAttribute('stroke-width', '2'); line.setAttribute('vector-effect', 'non-scaling-stroke');
      if (content.shape === 'arrow') {
        const defs = doc.createElementNS(ns, 'defs'), marker = doc.createElementNS(ns, 'marker');
        marker.id = `${patch.id}-tip`; marker.setAttribute('viewBox', '0 0 10 10'); marker.setAttribute('refX', '9'); marker.setAttribute('refY', '5'); marker.setAttribute('markerWidth', '5'); marker.setAttribute('markerHeight', '5'); marker.setAttribute('orient', 'auto-start-reverse');
        const tip = doc.createElementNS(ns, 'path'); tip.setAttribute('d', 'M0 0 L10 5 L0 10 Z'); tip.setAttribute('fill', 'currentColor'); marker.append(tip); defs.append(marker); svg.append(defs); line.setAttribute('marker-end', `url(#${marker.id})`);
      }
      svg.append(line);
    }
    element = svg;
  }
  if (content.kind === 'shape') { element.setAttribute('data-od-edit', 'container'); element.style.width = '160px'; element.style.height = ['line', 'arrow'].includes(content.shape) ? '2px' : '96px'; }
  element.setAttribute('data-od-id', patch.id);
  if (patch.placement) {
    const { left, top, width, height } = patch.placement;
    Object.assign(element.style, { position: 'absolute', left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
  }
  return element;
}
