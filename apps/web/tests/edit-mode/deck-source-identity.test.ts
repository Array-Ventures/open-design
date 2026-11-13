import { expect, it } from 'vitest';
import { deckSlideStateFromMessage, deckSourceIdentity } from '../../src/edit-mode/deck-source-identity';

it('rejects a previous srcdoc document even when the WindowProxy and slide count are unchanged', () => {
  const previous = { active: 0, count: 2, sourcePath: 'path-0-1', sourceGeneration: 'document-before' };
  expect(deckSourceIdentity(previous, 'document-before')).toEqual({ sourcePath: 'path-0-1', sourceGeneration: 'document-before' });
  expect(deckSourceIdentity(previous, 'document-after')).toBeNull();
  expect(deckSourceIdentity({ ...previous, sourceGeneration: 'document-after' }, 'document-after')).toEqual({ sourcePath: 'path-0-1', sourceGeneration: 'document-after' });
});
it('ignores a stale same-frame document packet rather than overwriting navigation with its index', () => {
  const previous = { type: 'od:slide-state', active: 1, count: 2, sourcePath: 'path-0-0', sourceGeneration: 'before' };
  expect(deckSlideStateFromMessage(previous, 'after')).toBeNull();
  expect(deckSlideStateFromMessage({ type: 'od:slide-state', active: 0, count: 2 }, 'after')).toEqual({ active: 0, count: 2 });
  for (const changed of [{ active: NaN }, { active: -1 }, { active: 0.5 }, { active: 2 }, { count: Infinity }, { count: -1 }, { count: 1.5 }]) expect(deckSlideStateFromMessage({ ...previous, sourceGeneration: 'after', ...changed }, 'after')).toBeNull();
});
it('requires bounded source paths and an explicit current generation', () => {
  for (const sourcePath of ['', 'path-1-x', 'path--1', 'path-1.2', 'path' + '-0'.repeat(251)]) expect(deckSourceIdentity({ sourcePath, sourceGeneration: 'current' }, 'current')).toBeNull();
  for (const message of [null, [], {}, { sourcePath: 'path-0' }, { sourcePath: 'path-0', sourceGeneration: 1 }]) expect(deckSourceIdentity(message, 'current')).toBeNull();
  expect(deckSourceIdentity({ sourcePath: 'path-0', sourceGeneration: '' }, '')).toBeNull();
});
