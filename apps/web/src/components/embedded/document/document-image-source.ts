import { markdownImageProjectPath } from '../../markdown-image-path';
const rasterData = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\r\n]+$/i;
const absoluteSource = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
export function localDocumentImageSource(src: string): boolean {
  return Boolean(src.trim()) && !absoluteSource.test(src.trim()) && !src.trim().startsWith('/api/');
}
export function dataDocumentImageSource(src: string): boolean { return src.length <= 2 * 1024 * 1024 && rasterData.test(src); }
export function supportedDocumentImage(src: string, fileName: string): boolean {
  return dataDocumentImageSource(src) || localDocumentImageSource(src) && Boolean(markdownImageProjectPath(fileName, src));
}
const maxImagePixels = 10000;
export function documentImageCssDimension(value: unknown, axis: 'width' | 'height'): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === 'auto') return text;
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?(px|pt|%)$/.exec(text);
  if (!match) return null;
  const amount = Number.parseFloat(text), unit = match[3];
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (unit === '%') return axis === 'width' && amount <= 100 ? text : null;
  return amount * (unit === 'pt' ? 4 / 3 : 1) <= maxImagePixels ? text : null;
}
export function documentImageDimension(value: unknown): number | null {
  const number = typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : 0;
  return Number.isInteger(number) && number > 0 && number <= maxImagePixels ? number : null;
}
export function documentImageAspectRatio(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,5})\s*\/\s*(\d{1,5})$/);
  if (!match || Number(match[1]) <= 0 || Number(match[2]) <= 0) return null;
  return `${Number(match[1])}/${Number(match[2])}`;
}
export function supportedDocumentImageElement(image: Element, fileName: string): boolean {
  if (!supportedDocumentImage(image.getAttribute('src') ?? '', fileName) || ['srcset', 'sizes', 'usemap', 'ismap', 'align'].some(name => image.hasAttribute(name))) return false;
  if (!['width', 'height'].every(name => !image.hasAttribute(name) || documentImageDimension(image.getAttribute(name)) !== null)) return false;
  const style = (image as HTMLElement).style;
  return !style || [...style].every(name => !style.getPropertyPriority(name) && (name === 'aspect-ratio' ? documentImageAspectRatio(style.getPropertyValue(name)) !== null : (name === 'width' || name === 'height') && documentImageCssDimension(style.getPropertyValue(name), name) !== null));
}
