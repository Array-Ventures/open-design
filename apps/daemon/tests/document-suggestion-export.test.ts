import { expect, it } from 'vitest';
import { documentHtml } from '@open-design/contracts/runtime/document';
import { prepareDocument, exportDocument } from '../src/embedded-render/documents.js';
const proposed = documentHtml('Review', '<p>Keep <del data-eve-suggestion="1" data-eve-suggestion-id="11111111-1111-4111-8111-111111111111" data-eve-suggestion-operation="delete">original</del></p>');
it('refuses pending suggestions at renderer preparation instead of silently flattening retained deletion', async () => {
  await expect(prepareDocument(proposed, 'review.html', 'Review')).rejects.toThrow('Resolve document suggestions');
});
it('keeps ordinary authored strikethrough export preparation separate from tracked changes', async () => {
  expect(await prepareDocument(documentHtml('Review', '<p><del>ordinary strike</del></p>'), 'review.html', 'Review')).toContain('ordinary strike');
});
it.each(['docx', 'markdown'] as const)('also refuses direct %s adapter calls that bypass preparation', async format => {
  await expect(exportDocument(proposed, proposed, 'review.html', format, 'Review', async () => null)).rejects.toThrow('Resolve document suggestions');
});
