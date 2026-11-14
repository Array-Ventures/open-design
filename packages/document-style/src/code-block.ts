import type { DocumentCodeBlockGeometry } from './presentation.js';

const pixels = (value: string) => /^-?\d+(?:\.\d+)?px$/.test(value) ? Number.parseFloat(value) : NaN;
const layoutQuantum = 1 / 64;
const near = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= layoutQuantum;
const edges = ['Top', 'Right', 'Bottom', 'Left'] as const;

/** Optional physical print receipt. Unknown containers, neighbors, pagination or
 * overflow retain their prior export path rather than receiving guessed layout. */
export function documentCodeBlockGeometry(document: Document, pre: HTMLElement, contentWidthPx: number, contentHeightPx: number): Partial<DocumentCodeBlockGeometry> {
  if (![contentWidthPx, contentHeightPx].every(value => Number.isFinite(value) && value > 0)) return {};
  const main = pre.parentElement, view = document.defaultView;
  if (!view || pre.tagName !== 'PRE' || main?.tagName !== 'MAIN' || main.parentElement !== document.body
    || document.body.children.length !== 1 || document.querySelectorAll('main').length !== 1
    || document.body.getAttribute('style') || main.getAttribute('style')) return {};
  const bodyStyle = view.getComputedStyle(document.body), mainStyle = view.getComputedStyle(main);
  if (!edges.every(edge => near(pixels(bodyStyle.getPropertyValue(`margin-${edge.toLowerCase()}`)), 0)
      && near(pixels(bodyStyle.getPropertyValue(`padding-${edge.toLowerCase()}`)), 0))
    || !edges.every(edge => near(pixels(mainStyle.getPropertyValue(`padding-${edge.toLowerCase()}`)), 0)
      && near(pixels(mainStyle.getPropertyValue(`border-${edge.toLowerCase()}-width`)), 0))
    || !near(main.getBoundingClientRect().width, contentWidthPx)
    || mainStyle.direction !== 'ltr' || mainStyle.writingMode !== 'horizontal-tb') return {};

  const measure = (element: HTMLElement) => {
    const style = view.getComputedStyle(element), rect = element.getBoundingClientRect();
    const top = pixels(style.paddingTop), bottom = pixels(style.paddingBottom);
    const left = pixels(style.paddingLeft), right = pixels(style.paddingRight);
    if (Array.from(element.style).some(name => name !== 'color')) return null;
    if (element.tagName !== 'PRE' || element.parentElement !== main || element.className
      || style.display !== 'block' || style.position !== 'static' || style.float !== 'none' || style.transform !== 'none'
      || !['start','left'].includes(style.textAlign) || style.direction !== 'ltr' || style.writingMode !== 'horizontal-tb' || style.whiteSpace !== 'pre'
      || !edges.every(edge => near(pixels(style.getPropertyValue(`border-${edge.toLowerCase()}-width`)), 0))
      || !near(pixels(style.marginLeft), 0) || !near(pixels(style.marginRight), 0)
      || ![top, bottom, left, right].every(value => Number.isFinite(value) && value >= 0)
      || !near(rect.width, contentWidthPx)) return null;
    const content = element.children.length === 1 && element.firstElementChild?.tagName === 'CODE' ? element.firstElementChild : element;
    if (content.className || !content.textContent?.trim() || /[\t\u2028\u2029]/.test(content.textContent)) return null;
    const range = document.createRange(); range.selectNodeContents(content);
    if (Array.from(range.getClientRects()).some(box => box.width > rect.width - left - right + layoutQuantum)) return null;
    const line = Math.max(pixels(style.lineHeight), pixels(view.getComputedStyle(content).lineHeight));
    const count = Math.round((rect.height - top - bottom) / line);
    if (!Number.isSafeInteger(count) || count < 1 || !near(rect.height - top - bottom, count * line)) return null;
    return { style, rect, top, bottom, left, right, count };
  };
  const own = measure(pre); if (!own) return {};
  const neighbor = (element: Element | null, margin: 'marginTop' | 'marginBottom') => {
    if (!element) return { margin: 0, paddingBottom: 0 };
    if (!/^(?:P|H[1-6]|PRE)$/.test(element.tagName) || element.querySelector('img,math,table,input,hr')) return null;
    if (element.getAttribute('style')) return null;
    const style = view.getComputedStyle(element), code = element.tagName === 'PRE' ? measure(element as HTMLElement) : null;
    if (element.tagName === 'PRE' && !code) return null;
    return { margin: pixels(style[margin]), paddingBottom: code?.bottom ?? 0 };
  };
  const before = neighbor(pre.previousElementSibling, 'marginBottom'), after = neighbor(pre.nextElementSibling, 'marginTop');
  const mainTop = main.getBoundingClientRect().top;
  if (!before || !after || own.rect.top - mainTop < -layoutQuantum || own.rect.bottom - mainTop > contentHeightPx + layoutQuantum) return {};
  const marginTop = pixels(own.style.marginTop), marginBottom = pixels(own.style.marginBottom);
  if (![before.margin, after.margin, marginTop, marginBottom].every(value => Number.isFinite(value) && value >= 0)) return {};
  return {
    codeBlockSource: 'canonical-pre',
    codeBlockBeforePt: (Math.max(before.margin, marginTop) + own.top + before.paddingBottom) * .75,
    codeBlockAfterPt: (Math.max(marginBottom, after.margin) + own.bottom) * .75,
    codeBlockStartPt: own.left * .75, codeBlockEndPt: own.right * .75, codeBlockLineCount: own.count,
  };
}
