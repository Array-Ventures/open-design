import { z } from 'zod';

const font = z.enum(['sans', 'serif']);
const ids = z.array(z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)).max(10000).optional();
export const documentMetadataSchema = z.object({
  version: z.literal(1), fonts: z.object({ text: font, headings: font }).strict(),
  ids: z.object({ paragraph: ids, heading: ids, quote: ids, listitem: ids, tablecell: ids, code: ids, list: ids, table: ids }).strict(),
  bodySha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
export type MarkdownDocumentMetadata = z.infer<typeof documentMetadataSchema>;
export const documentMetadataDirective = /^<!-- eve-document:([A-Za-z0-9+/=]+) -->\r?\n(?:\r?\n)?/;


export const documentFontFamily = (font: 'sans' | 'serif'): string => font === 'serif' ? 'Georgia, serif' : 'system-ui, sans-serif';

/** Standalone content styling also works in isolated HTML/PDF/Word conversion. */
export function documentHtml(title: string, body: string, font: 'sans' | 'serif' = 'sans', headingFont: 'sans' | 'serif' = 'serif'): string {
  const escaped = title.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  return `<!doctype html><html data-eve-document="1" data-eve-document-font="${font}" data-eve-document-heading-font="${headingFont}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escaped}</title><style>body{margin:0;padding:64px 52px;background:Canvas;color:CanvasText;font:16px/1.5 ${documentFontFamily(font)}}main{max-width:720px;margin:0 auto}p{margin:0 0 1em}h1,h2,h3,h4,h5,h6{font-family:${documentFontFamily(headingFont)};line-height:1.25;margin:1.4em 0 .6em}h1{font-size:2em;line-height:40px;margin:24px 0 16px}h2{font-size:1.5em;line-height:32px;margin:24px 0 12px}h3{font-size:1.25em;line-height:28px;margin:24px 0 12px}main>:first-child{margin-top:0}ul,ol{padding-inline-start:24px;margin-block:16px}table{border-collapse:collapse;width:100%;margin:1em 0}td,th{border:1px solid GrayText;padding:8px;vertical-align:top}td p,th p{margin:0}th{text-align:start}blockquote{border-inline-start:3px solid GrayText;margin-inline:0;padding-inline-start:16px}a{color:LinkText}pre{overflow-x:auto;white-space:pre;padding:16px;font:14px/1.5 monospace}code{font-family:monospace}ul[__lexicallisttype="check"]{list-style:none}li[aria-checked="true"]::marker{content:"☑ "}li[aria-checked="false"]::marker{content:"☐ "}@media print{body{padding:0}table{break-inside:avoid}}</style></head><body><main>${body}</main></body></html>`;
}

