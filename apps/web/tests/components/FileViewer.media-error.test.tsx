// @vitest-environment jsdom
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FileViewer } from '../../src/components/FileViewer';
import type { ProjectFile } from '../../src/types';
import { I18nProvider, LOCALES, tForLanguageTag } from '../../src/i18n';

const file = (kind: 'audio' | 'video', mtime = 1): ProjectFile => ({
  kind, name: `sample.${kind === 'audio' ? 'mp3' : 'mp4'}`,
  path: `sample.${kind === 'audio' ? 'mp3' : 'mp4'}`,
  type: 'file', size: 1024, mtime, mime: kind === 'audio' ? 'audio/mpeg' : 'video/mp4',
});
beforeEach(() => { vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['audio', 'video'] as const)('replaces failed %s playback with an accessible message and its existing original-file actions', kind => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
  const view = render(<FileViewer projectId="owned-media-project" projectKind={kind} file={file(kind)} />);
  const media = view.container.querySelector(kind)!;
  const originalDownload = screen.getByRole('link', { name: 'Download' }).getAttribute('href');
  Object.defineProperty(media, 'error', { configurable: true, value: { code: 4, message: 'PRIVATE decoder diagnostic https://foreign.invalid/unsafe' } });
  fireEvent.error(media);
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('Preview unavailable.');
  expect(within(alert).getByRole('link', { name: 'Download' })).toHaveAttribute('href', originalDownload);
  expect(within(alert).getByRole('link', { name: 'Download' })).toHaveAttribute('download', file(kind).name);
  expect(alert.textContent).not.toContain('PRIVATE');
  expect(alert.innerHTML).not.toContain('foreign.invalid');
  expect(view.container.querySelector(kind)).toBeNull();
});


it.each(['audio', 'video'] as const)('retires only the old %s revision and keeps later error events from poisoning its replacement', kind => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
  const view = render(<FileViewer projectId="owned-media-project" projectKind={kind} file={file(kind, 1)} />);
  const old = view.container.querySelector(kind)!;
  Object.defineProperty(old, 'error', { configurable: true, value: { code: 3, message: 'decoder details' } });
  fireEvent.error(old);
  expect(screen.getByRole('alert')).toBeInTheDocument();
  view.rerender(<FileViewer projectId="owned-media-project" projectKind={kind} file={file(kind, 2)} />);
  const fresh = view.container.querySelector(kind)!;
  expect(fresh).not.toBe(old);
  expect(vi.mocked(HTMLMediaElement.prototype.pause).mock.contexts).toContain(old);
  expect(fresh).toHaveAttribute('controls');
  expect(fresh).toHaveAttribute('preload', 'metadata');
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.error(old);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(view.container.querySelector(kind)).toBe(fresh);
  // A healthy native element without MediaError cannot be replaced by a noisy event.
  fireEvent.error(fresh);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(fresh).toHaveAttribute('src', expect.stringContaining('v=2'));
});

it.each([2, 3, 99])('keeps code %s failures generic and never adopts diagnostics as an action URL', code => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
  const view = render(<FileViewer projectId="owned-media-project" projectKind="video" file={file('video')} />);
  const video = view.container.querySelector('video')!;
  Object.defineProperty(video, 'error', { configurable: true, value: { code, message: 'https://foreign.invalid/PRIVATE?key=diagnostic' } });
  fireEvent.error(video);
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('Preview unavailable.');
  expect(alert.textContent).not.toMatch(/network|codec|PRIVATE/);
  for (const link of within(alert).getAllByRole('link')) expect(link.getAttribute('href')).not.toContain('foreign.invalid');
});

it.each(LOCALES)('uses existing localized failure and original-file actions in %s', locale => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
  const translate = tForLanguageTag(locale)!;
  const view = render(<I18nProvider initial={locale}><FileViewer projectId="owned-media-project" projectKind="audio" file={file('audio')} /></I18nProvider>);
  const audio = view.container.querySelector('audio')!;
  Object.defineProperty(audio, 'error', { configurable: true, value: { code: 4 } });
  fireEvent.error(audio);
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent(translate('fileViewer.previewUnavailable'));
  expect(within(alert).getByRole('link', { name: translate('fileViewer.download') })).toHaveAttribute('download', 'sample.mp3');
  expect(within(alert).getByRole('link', { name: translate('fileViewer.open') })).toHaveAttribute('rel', 'noreferrer noopener');
  expect(document.documentElement.dir).toBe(['ar', 'fa'].includes(locale) ? 'rtl' : 'ltr');
});


it.each(['audio', 'video'] as const)('keeps healthy %s source and controls through StrictMode cleanup replay', kind => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
  const view = render(<StrictMode><FileViewer projectId="owned-media-project" projectKind={kind} file={file(kind)} /></StrictMode>);
  const media = view.container.querySelector(kind)!;
  expect(media).toHaveAttribute('controls');
  expect(media).toHaveAttribute('src', expect.stringContaining('v=1'));
  expect(screen.queryByRole('alert')).toBeNull();
  view.unmount();
  expect(vi.mocked(HTMLMediaElement.prototype.pause).mock.contexts).toContain(media);
});
