import { createContext, useContext, type JSX } from 'react';
import { $applyNodeReplacement, type DOMConversionMap, type DOMExportOutput, type LexicalEditor, type LexicalNode, type LexicalUpdateJSON, type NodeKey, type SerializedLexicalNode, type Spread, DecoratorNode } from 'lexical';
import { markdownImageSourceUrl } from '../../markdown-image-path';

import { documentImageCssDimension, supportedDocumentImage, localDocumentImageSource, dataDocumentImageSource, documentImageDimension as dimension, documentImageAspectRatio as aspectRatio } from './document-image-source';
export const DocumentImageScope = createContext<{ projectId: string; fileName: string } | null>(null);
type ImageData = { src: string; alt: string; title?: string; width?: number | null; height?: number | null; aspectRatio?: string | null; cssWidth?: string | null; cssHeight?: string | null };
function validateImage(data: ImageData) {
  if (typeof data.src !== 'string' || typeof data.alt !== 'string' || data.title !== undefined && typeof data.title !== 'string' || !(localDocumentImageSource(data.src) || dataDocumentImageSource(data.src))) throw new Error('This image source is not supported.');
  if (data.cssWidth != null && !documentImageCssDimension(data.cssWidth, 'width') || data.cssHeight != null && !documentImageCssDimension(data.cssHeight, 'height')) throw new Error('This image size is not supported.');
}
export type SerializedDocumentImage = Spread<ImageData, SerializedLexicalNode>;

/** Persistent image data contains document-relative paths, never authenticated display URLs. */
export class DocumentImageNode extends DecoratorNode<JSX.Element> {
  __src: string; __alt: string; __title: string; __width: number | null; __height: number | null; __aspectRatio: string | null; __cssWidth: string | null; __cssHeight: string | null;
  static getType(): string { return 'image'; }
  static clone(node: DocumentImageNode): DocumentImageNode { return new DocumentImageNode({ src: node.__src, alt: node.__alt, title: node.__title, width: node.__width, height: node.__height, aspectRatio: node.__aspectRatio, cssWidth: node.__cssWidth, cssHeight: node.__cssHeight }, node.__key); }
  constructor(data: ImageData, key?: NodeKey) {
    super(key); validateImage(data); this.__src = data.src; this.__alt = data.alt; this.__title = data.title ?? ''; this.__width = dimension(data.width); this.__height = dimension(data.height); this.__aspectRatio = aspectRatio(data.aspectRatio); this.__cssWidth = data.cssWidth ?? null; this.__cssHeight = data.cssHeight ?? null;
  }
  static importJSON(value: SerializedDocumentImage): DocumentImageNode { return $createDocumentImageNode(value).updateFromJSON(value); }
  updateFromJSON(value: LexicalUpdateJSON<SerializedDocumentImage>): this {
    validateImage(value);
    const node = super.updateFromJSON(value);
    const writable = node.getWritable(); writable.__src = value.src; writable.__alt = value.alt; writable.__title = value.title ?? ''; writable.__width = dimension(value.width); writable.__height = dimension(value.height); writable.__aspectRatio = aspectRatio(value.aspectRatio); writable.__cssWidth = value.cssWidth ?? null; writable.__cssHeight = value.cssHeight ?? null;
    return node;
  }
  exportJSON(): SerializedDocumentImage { return { ...super.exportJSON(), type: 'image', version: 1, src: this.__src, alt: this.__alt, title: this.__title, width: this.__width, height: this.__height, aspectRatio: this.__aspectRatio, cssWidth: this.__cssWidth, cssHeight: this.__cssHeight }; }
  static importDOM(): DOMConversionMap {
    const convert = (element: HTMLElement) => ({ node: $createDocumentImageNode({ src: element.getAttribute('src') ?? '', alt: element.getAttribute('alt') ?? '', title: element.getAttribute('title') ?? '', width: dimension(element.getAttribute('width')), height: dimension(element.getAttribute('height')), aspectRatio: aspectRatio(element.style.aspectRatio), cssWidth: documentImageCssDimension(element.style.width, 'width'), cssHeight: documentImageCssDimension(element.style.height, 'height') }), after: () => [] });
    return {
      img: () => ({ priority: 1, conversion: convert }),
      span: element => element.getAttribute('data-eve-document-image') === '1' && element.children.length === 1 && element.firstElementChild?.tagName === 'IMG' && !element.textContent?.trim()
        ? { priority: 2, conversion: () => convert(element.firstElementChild as HTMLElement) } : null,
    };
  }
  exportDOM(_editor: LexicalEditor): DOMExportOutput {
    const image = document.createElement('img'); image.setAttribute('src', this.__src); image.setAttribute('alt', this.__alt);
    if (this.__title) image.setAttribute('title', this.__title);
    if (this.__width) image.setAttribute('width', String(this.__width));
    if (this.__height) image.setAttribute('height', String(this.__height));
    if (this.__aspectRatio) image.style.aspectRatio = this.__aspectRatio;
    if (this.__cssWidth) image.style.width = this.__cssWidth;
    if (this.__cssHeight) image.style.height = this.__cssHeight;
    const wrapper = document.createElement('span'); wrapper.setAttribute('data-eve-document-image', '1'); wrapper.append(image);
    return { element: wrapper };
  }
  getImageData(): ImageData { const node = this.getLatest(); return { src: node.__src, alt: node.__alt, title: node.__title, width: node.__width, height: node.__height, aspectRatio: node.__aspectRatio, cssWidth: node.__cssWidth, cssHeight: node.__cssHeight }; }
  createDOM(): HTMLElement { return document.createElement('span'); }
  updateDOM(): false { return false; }
  isInline(): true { return true; }
  decorate(): JSX.Element { return <DocumentImage data={this.getImageData()} />; }
}
function DocumentImage({ data }: { data: ImageData }) {
  const scope = useContext(DocumentImageScope);
  const src = scope && supportedDocumentImage(data.src, scope.fileName) ? markdownImageSourceUrl(scope.projectId, scope.fileName, data.src) : null;
  if (!src) return <span role="img" aria-label={data.alt || 'Image unavailable'} className="text-body-2-regular text-text-tertiary">{data.alt || 'Image unavailable'}</span>;
  return <img src={src} alt={data.alt} title={data.title || undefined} width={data.width ?? undefined} height={data.height ?? undefined} draggable={false} referrerPolicy="no-referrer" style={{ maxWidth: '100%', ...(data.cssWidth ? { width: data.cssWidth } : {}), height: data.cssHeight ?? 'auto', ...(data.aspectRatio ? { aspectRatio: data.aspectRatio } : {}) }} />;
}
export function $createDocumentImageNode(data: ImageData): DocumentImageNode { return $applyNodeReplacement(new DocumentImageNode(data)); }
export function $isDocumentImageNode(node: LexicalNode | null | undefined): node is DocumentImageNode { return node instanceof DocumentImageNode; }
