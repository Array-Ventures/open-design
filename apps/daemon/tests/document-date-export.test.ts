import { expect, it } from 'vitest';
import { documentHtml } from '@open-design/contracts/runtime/document';
import { prepareDocument, exportDocument } from '../src/embedded-render/documents.js';
const date = '<time data-eve-document-date="1" datetime="2024-02-29" data-eve-date-locale="en-US">Persisted leap day</time>';
it('retains a noninteractive semantic date and its persisted visible label in document print preparation', async () => {
  const html = documentHtml('Dates', `<p>Before ${date} after.</p>`);
  expect(await prepareDocument(html, 'dates.html', 'Dates')).toContain(date);
});
it.each(['docx', 'markdown'] as const)('keeps Date proposals behind the existing %s unresolved-review refusal', async format => {
  const html = documentHtml('Dates', `<p><ins data-eve-suggestion="1" data-eve-suggestion-id="11111111-1111-4111-8111-111111111111" data-eve-suggestion-operation="insert">${date}</ins></p>`);
  await expect(exportDocument(html, html, 'dates.html', format, 'Dates', async () => null)).rejects.toThrow('Resolve document suggestions');
});
