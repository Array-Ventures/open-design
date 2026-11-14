// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { hasCommentBody, mentionsKnownBot, useCommentChatDefault } from '../../../src/components/embedded/useCommentChatDefault';
const bots = [{ id: 'chief', name: 'Chief' }, { id: 'ava', name: 'Ava Chen' }, { id: 'math', name: 'A+B' }];
vi.mock('../../../src/components/embedded/host-viewer', () => ({ useEmbeddedMentionBots: () => bots }));
it.each(['@Chief', 'Ask @cHiEf.', '(@Ava Chen), please', '@A+B help'])('matches a complete known bot name: %s', value => {
  expect(mentionsKnownBot(value, bots)).toBe(true);
});
it.each(['hello@Chief.com', 'x@Chief', '@Chiefly', '@Chief_2', '@Chief-bot', '@Unknown', '@Ava', '@Ava Chenmore', '@@Chief', 'foo.@Chief'])('ignores emails, partial handles and unknown names: %s', value => {
  expect(mentionsKnownBot(value, bots)).toBe(false);
});
it('retains manual choices through more mentions and permission changes, resetting for every new target', () => {
  const initialProps = { value: '', key: 'one', enabled: true, fresh: true };
  const hook = renderHook(({ value, key, enabled, fresh }) => useCommentChatDefault(value, key, enabled, fresh), { initialProps });
  expect(hook.result.current.selected).toBe(false);
  hook.rerender({ ...initialProps, value: '@Chief' }); expect(hook.result.current.selected).toBe(true);
  act(() => hook.result.current.choose(false));
  hook.rerender({ ...initialProps, value: '@Chief @Ava Chen' }); expect(hook.result.current.selected).toBe(false);
  hook.rerender({ ...initialProps, value: '@Chief', enabled: false }); expect(hook.result.current.selected).toBe(false);
  hook.rerender({ ...initialProps, value: '@Chief' }); expect(hook.result.current.selected).toBe(false);
  hook.rerender({ ...initialProps, key: 'two', value: '@Chief' }); expect(hook.result.current.selected).toBe(true);
  hook.rerender({ ...initialProps, key: 'one', value: '@Chief' }); expect(hook.result.current.selected).toBe(true);
});
it('checks only active root composers, and retains a manual check without a mention', () => {
  const hook = renderHook(({ fresh, value }) => useCommentChatDefault(value, 'root', true, fresh), { initialProps: { fresh: false, value: '@Chief' } });
  expect(hook.result.current.selected).toBe(false);
  hook.rerender({ fresh: true, value: '@Chief' }); expect(hook.result.current.selected).toBe(true);
  act(() => hook.result.current.choose(true));
  hook.rerender({ fresh: true, value: 'Plain note' }); expect(hook.result.current.selected).toBe(true);
});

it('updates the automatic default when a mention is removed, without overriding a manual check', () => {
  const hook = renderHook(({ value }) => useCommentChatDefault(value, 'draft', true, true), { initialProps: { value: '@Chief help' } });
  expect(hook.result.current.selected).toBe(true);
  hook.rerender({ value: 'help' }); expect(hook.result.current.selected).toBe(false);
  act(() => hook.result.current.choose(true));
  hook.rerender({ value: 'more plain text' }); expect(hook.result.current.selected).toBe(true);
});

it.each(['', '  ', '@Chief', ' @Chief  @Ava Chen ', '@A+B'])('requires a body beyond known recipients: %s', value => {
  expect(hasCommentBody(value, bots)).toBe(false);
});
it.each(['A note', '@Chief help', 'help @Ava Chen', '@Unknown', 'hello@Chief.com', '@Chiefly', '@Chief !'])('preserves actual text and unrecognized handles: %s', value => {
  expect(hasCommentBody(value, bots)).toBe(true);
});
it('uses normalized offsets consistently for Unicode names and overlapping recipients', () => {
  const unicode = [{ id: 'i', name: 'İpek' }, { id: 'a', name: 'Ava' }, { id: 'ac', name: 'Ava Chen' }];
  expect(hasCommentBody('@İpek @Ava Chen', unicode)).toBe(false);
  expect(hasCommentBody('@İpek note', unicode)).toBe(true);
});
