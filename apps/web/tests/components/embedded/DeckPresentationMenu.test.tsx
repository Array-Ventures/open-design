// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DeckPresentationMenu } from '../../../src/components/embedded/DeckPresentationMenu';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('keeps hosted presentation in the native header and accepts only its scoped parent command', () => {
  const parent = { postMessage: vi.fn() };
  vi.spyOn(window, 'parent', 'get').mockReturnValue(parent as unknown as Window);
  const onPresent = vi.fn();
  const { container, unmount } = render(<DeckPresentationMenu projectId="project-a" hosted onPresent={onPresent} />);
  expect(container).toBeEmptyDOMElement();
  const state = parent.postMessage.mock.calls[0]![0];
  expect(state).toMatchObject({ type: 'studio:presentation-state', projectId: 'project-a' });
  const send = (data: unknown, source: MessageEventSource | null = parent as unknown as Window, origin = window.location.origin) => window.dispatchEvent(new MessageEvent('message', { data, source, origin }));
  const command = { type: 'studio:presentation-control', projectId: 'project-a', controllerId: state.controllerId, withNotes: true };
  send(command, window);
  send(command, parent as unknown as Window, 'https://other.test');
  send({ ...command, projectId: 'project-b' });
  send({ ...command, controllerId: 'old-controller' });
  send({ ...command, withNotes: 'yes' });
  expect(onPresent).not.toHaveBeenCalled();
  send(command);
  expect(onPresent).toHaveBeenCalledExactlyOnceWith(true);
  unmount();
  expect(parent.postMessage).toHaveBeenLastCalledWith({ type: 'studio:presentation-unavailable', projectId: 'project-a', controllerId: state.controllerId }, window.location.origin);
});
