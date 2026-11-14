// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { createEditor, $getRoot } from 'lexical';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import { HeadingNode } from '@lexical/rich-text';
import { DocumentImageNode } from '../../../src/components/embedded/document/DocumentImageNode';
import { documentHtml, documentImport } from '../../../src/components/embedded/document/document-html';
import { documentHtmlConfig } from '../../../src/components/embedded/document/document-identity';
import { supportedDocument } from '../../../src/components/embedded/document/document-admission';

const source = 'images/owned.png';
const editor = () => createEditor({ nodes: [HeadingNode, DocumentImageNode], html: documentHtmlConfig(), onError: error => { throw error; } });
for (const attributes of [
  'width="24" height="24" style="height:24px"',
  'style="width:50%;height:24px"',
  'style="width:252pt;height:18pt"',
]) it(`admits source image dimensions that must survive editing: ${attributes}`, () => {
  expect(supportedDocument(documentHtml('Owned', `<h1><img src="${source}" alt="Owned" ${attributes}></h1>`), 'report.html')).toBe(true);
});
for (const dimensions of [
  { width:'50%',height:'24px' },
  { width:'252pt',height:'18pt' },
]) it(`retains authored image units through actual Lexical import, JSON and HTML reopen: ${dimensions.width}`, () => {
  const before = editor();
  before.update(() => { $getRoot().append(...$generateNodesFromDOM(before, documentImport(`<h1 data-od-id="heading"><img data-od-id="image" src="${source}" alt="Owned" width="24" height="24" style="width:${dimensions.width};height:${dimensions.height}"></h1>`))); }, { discrete:true });
  const reopened = editor(); reopened.setEditorState(reopened.parseEditorState(JSON.stringify(before.getEditorState().toJSON())));
  const exported = reopened.getEditorState().read(() => $generateHtmlFromNodes(reopened));
  const image = new DOMParser().parseFromString(exported,'text/html').querySelector('img')!;
  expect(image.getAttribute('width')).toBe('24'); expect(image.getAttribute('height')).toBe('24');
  expect(image.style.width).toBe(dimensions.width); expect(image.style.height).toBe(dimensions.height);
  expect(image.getAttribute('src')).toBe(source);
  expect(image.closest('[data-od-id]')?.getAttribute('data-od-id')).toBe('image');
});
it('admits a direct source IMG identity that the existing node already preserves', () => {
  expect(supportedDocument(documentHtml('Owned', `<h1><img data-od-id="image" src="${source}" alt="Owned"></h1>`), 'report.html')).toBe(true);
});

it.each([
  'width:calc(50% + 0px)', 'width:10vw', 'width:var(--size)', 'height:50%',
  'width:0px', 'width:10001px', 'width:7501pt', 'width:101%', 'height:24px!important',
  'width:calc(50% + 0px);width:50%', 'height:24px;position:absolute',
])('refuses unowned image geometry rather than stripping it: %s', style => {
  expect(supportedDocument(documentHtml('Owned', `<p><img src="${source}" style="${style}"></p>`), 'report.html')).toBe(false);
});
it('does not widen other element dimension admission', () => {
  expect(supportedDocument(documentHtml('Owned', '<p style="width:50%">Text</p>'), 'report.html')).toBe(false);
  expect(supportedDocument(documentHtml('Owned', '<table><tr><td style="width:18pt">Text</td></tr></table>'), 'report.html')).toBe(false);
});
it.each(['', 'style="width:auto;height:auto"'])('keeps intrinsic source absence separate from explicit auto: %s', attributes => {
  const active = editor();
  active.update(() => { $getRoot().append(...$generateNodesFromDOM(active, documentImport(`<p><img src="${source}" ${attributes}></p>`))); }, { discrete:true });
  const image = new DOMParser().parseFromString(active.getEditorState().read(() => $generateHtmlFromNodes(active)), 'text/html').querySelector('img')!;
  expect(image.hasAttribute('width')).toBe(false); expect(image.hasAttribute('height')).toBe(false);
  expect(image.style.width).toBe(attributes ? 'auto' : ''); expect(image.style.height).toBe(attributes ? 'auto' : '');
});
it.each(['', 'data-od-id="image"'])('uses one existing image identity when a generated wrapper has %s', outer => {
  const markup = `<p><span data-eve-document-image="1" ${outer}><img data-od-id="image" src="${source}"></span></p>`;
  expect(supportedDocument(documentHtml('Owned', markup), 'report.html')).toBe(true);
  const active = editor(); active.update(() => $getRoot().append(...$generateNodesFromDOM(active, documentImport(markup))), { discrete:true });
  const exported = new DOMParser().parseFromString(active.getEditorState().read(() => $generateHtmlFromNodes(active)), 'text/html');
  expect(exported.querySelectorAll('[data-od-id="image"]')).toHaveLength(1);
});
it('refuses competing wrapper and inner image identities', () => {
  expect(supportedDocument(documentHtml('Owned', `<p><span data-eve-document-image="1" data-od-id="outer"><img data-od-id="inner" src="${source}"></span></p>`), 'report.html')).toBe(false);
});
it('preserves authored CSS dimensions through real Lexical Undo/Redo and clone state', async () => {
  const { registerHistory, createEmptyHistoryState } = await import('@lexical/history');
  const { HISTORY_PUSH_TAG, UNDO_COMMAND, REDO_COMMAND } = await import('lexical');
  const active = editor();
  active.update(() => $getRoot().append(...$generateNodesFromDOM(active, documentImport(`<h1><img src="${source}" width="24" height="24" style="width:50%;height:18pt"></h1>`))), { discrete:true });
  const unregister = registerHistory(active, createEmptyHistoryState(), 300);
  const image = () => $getRoot().getFirstChild()!.getLatest().getType() === 'heading'
    ? ($getRoot().getFirstChild() as import('@lexical/rich-text').HeadingNode).getFirstChild() as DocumentImageNode : null;
  try {
    active.update(() => image()!.updateFromJSON({ ...image()!.exportJSON(), cssWidth:'60%' }), { discrete:true, tag:HISTORY_PUSH_TAG });
    active.update(() => image()!.updateFromJSON({ ...image()!.exportJSON(), cssWidth:'75%' }), { discrete:true, tag:HISTORY_PUSH_TAG });
    active.dispatchCommand(UNDO_COMMAND, undefined); await Promise.resolve();
    expect(active.getEditorState().read(() => image()!.getImageData())).toMatchObject({ width:24,height:24,cssWidth:'60%',cssHeight:'18pt' });
    active.dispatchCommand(REDO_COMMAND, undefined); await Promise.resolve();
    expect(active.getEditorState().read(() => image()!.getImageData())).toMatchObject({ width:24,height:24,cssWidth:'75%',cssHeight:'18pt' });
  } finally { unregister(); }
});

it.each([
  ['cssWidth', 50], ['cssHeight', {}], ['cssWidth', 'calc(50% + 0px)'],
  ['cssWidth', '10001px'], ['cssWidth', '101%'], ['cssHeight', '50%'],
])('refuses malformed serialized %s without silently dropping it: %j', (field, value) => {
  const active = editor();
  active.update(() => $getRoot().append(...$generateNodesFromDOM(active, documentImport(`<h1><img src="${source}" width="24" height="24"></h1>`))), { discrete:true });
  const state = active.getEditorState().toJSON();
  const heading = state.root.children[0] as import('lexical').SerializedElementNode;
  Object.assign(heading.children[0]!, { [field]:value });
  expect(() => editor().parseEditorState(JSON.stringify(state))).toThrow('This image size is not supported');
});
it('reopens legacy image JSON without adding authored CSS dimensions', () => {
  const active = editor();
  active.update(() => $getRoot().append(...$generateNodesFromDOM(active, documentImport(`<h1><img src="${source}" width="24" height="24"></h1>`))), { discrete:true });
  const state = active.getEditorState().toJSON();
  const image = (state.root.children[0] as import('lexical').SerializedElementNode).children[0] as import('../../../src/components/embedded/document/DocumentImageNode').SerializedDocumentImage;
  delete image.cssWidth; delete image.cssHeight;
  const restored = editor(); restored.setEditorState(restored.parseEditorState(JSON.stringify(state)));
  const html = restored.getEditorState().read(() => $generateHtmlFromNodes(restored));
  const output = new DOMParser().parseFromString(html,'text/html').querySelector('img')!;
  expect(output.getAttribute('width')).toBe('24'); expect(output.getAttribute('height')).toBe('24');
  expect(output.style.width).toBe(''); expect(output.style.height).toBe('');
});

it('retains CSS image units through the existing Markdown source receipt and reopen path', async () => {
  const { readMarkdownDocument, finalizeMarkdownDocument } = await import('../../../src/components/embedded/document/markdown-document');
  const { serializeMarkdownDocument } = await import('../../../src/components/embedded/document/markdown-serialization');
  const { initializeDocumentBlockIds, restoreDocumentIdentityGroups } = await import('../../../src/components/embedded/document/document-identity');
  const loaded = await readMarkdownDocument(`# Owned\n\n<img src="${source}" alt="Owned" style="width:50%;height:18pt">`, 'Owned');
  const active = editor();
  active.update(() => {
    $getRoot().append(...$generateNodesFromDOM(active, documentImport(loaded.html)));
    initializeDocumentBlockIds(new Map(), 'original');
  }, { discrete:true });
  const saved = await finalizeMarkdownDocument(active.getEditorState().read(() => serializeMarkdownDocument(active)));
  const after = await readMarkdownDocument(saved, 'Owned');
  const reopened = editor(); reopened.update(() => {
    $getRoot().append(...$generateNodesFromDOM(reopened, documentImport(after.html)));
    restoreDocumentIdentityGroups(after.identities);
  }, { discrete:true });
  const image = new DOMParser().parseFromString(reopened.getEditorState().read(() => $generateHtmlFromNodes(reopened)), 'text/html').querySelector('img')!;
  expect(image.style.width).toBe('50%'); expect(image.style.height).toBe('18pt');
  expect(image.getAttribute('src')).toBe(source); expect(image.hasAttribute('width')).toBe(false); expect(image.hasAttribute('height')).toBe(false);
});
