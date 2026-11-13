import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { documentMetadataSchema as metadataSchema, documentMetadataDirective as directive, type MarkdownDocumentMetadata } from '@open-design/contracts/runtime/document';
export type { MarkdownDocumentMetadata } from '@open-design/contracts/runtime/document';
import { documentDigest } from './document-digest';
import { documentHtml } from './document-html';

export function encodeMarkdownDocument(body: string, metadata: MarkdownDocumentMetadata): string {
  const safe = metadataSchema.parse(metadata);
  return `<!-- eve-document:${btoa(JSON.stringify(safe))} -->\n\n${body}`;
}
function decodeMarkdownDocument(source: string): { body: string; metadata: MarkdownDocumentMetadata | null } {
  const match = source.match(directive);
  if (match) {
    try {
      const parsed = metadataSchema.safeParse(JSON.parse(atob(match[1]!)));
      if (parsed.success) return { body: source.slice(match[0].length), metadata: parsed.data };
    } catch { /* Ordinary Markdown comments remain ordinary content. */ }
  }
  return { body: source, metadata: null };
}

/** IDs are restored only when the entire Markdown body matches the saved receipt. */
export async function readMarkdownDocument(source: string, title: string) {
  const parsed = decodeMarkdownDocument(source);
  const validIds = parsed.metadata?.bodySha256 === await documentDigest(new TextEncoder().encode(parsed.body));
  // Raw HTML is admitted only into the document import boundary, which validates nodes and sanitizes it.
  const html = micromark(parsed.body, { extensions: [gfm()], htmlExtensions: [gfmHtml()], allowDangerousHtml: true });
  const dom = new DOMParser().parseFromString(html, 'text/html');
  for (const input of dom.querySelectorAll<HTMLInputElement>('li > input[type="checkbox"]')) {
    const item = input.parentElement!;
    item.setAttribute('aria-checked', input.checked ? 'true' : 'false');
    item.parentElement?.setAttribute('__lexicallisttype', 'check');
    input.remove();
  }
  for (const cell of dom.querySelectorAll('th[align],td[align]')) {
    const align = cell.getAttribute('align');
    if (align && ['left', 'center', 'right'].includes(align)) {
      const paragraph = dom.createElement('p'); paragraph.style.textAlign = align;
      paragraph.append(...cell.childNodes); cell.append(paragraph);
    }
    cell.removeAttribute('align');
  }
  for (const code of dom.querySelectorAll('pre > code')) {
    const language = [...code.classList].find(name => name.startsWith('language-'))?.slice(9);
    if (language && /^[A-Za-z0-9_-]{1,40}$/.test(language)) code.parentElement!.setAttribute('data-language', language);
    // A fenced block's terminating newline is Markdown syntax, not an extra code line.
    code.textContent = (code.textContent ?? '').replace(/\n$/, '');
  }
  return {
    html: documentHtml(title, dom.body.innerHTML, parsed.metadata?.fonts.text ?? 'sans', parsed.metadata?.fonts.headings ?? 'serif'),
    identities: validIds ? parsed.metadata?.ids : undefined,
  };
}

/** Finalize the body receipt immediately before the conditional file write. */
export async function finalizeMarkdownDocument(source: string): Promise<string> {
  const parsed = decodeMarkdownDocument(source);
  if (!parsed.metadata) return source;
  return encodeMarkdownDocument(parsed.body, { ...parsed.metadata, bodySha256: await documentDigest(new TextEncoder().encode(parsed.body)) });
}
