// @vitest-environment jsdom

import { createHash } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FileViewer,
  cancelManualEditPendingStyleSnapshot,
} from '../../src/components/FileViewer';
import { emptyManualEditStyles, type ManualEditTarget } from '../../src/edit-mode/types';
import type { ProjectFile } from '../../src/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('FileViewer manual edit regressions', () => {
  function clickManualTool(testId: string) {
    fireEvent.click(screen.getByTestId(testId));
  }

  async function previewFrame() {
    return waitFor(() => {
      const node = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
      if (!node.contentWindow) throw new Error('Preview frame not ready');
      return node;
    });
  }

  async function enterManualEditMode() {
    const initialFrame = await previewFrame();
    const postMessageSpy = vi.spyOn(initialFrame.contentWindow!, 'postMessage');

    clickManualTool('manual-edit-mode-toggle');

    const captureRequest = postMessageSpy.mock.calls
      .map(([value]) => value)
      .find((value) => (
        typeof value === 'object' &&
        value !== null &&
        (value as { type?: unknown }).type === 'od:preview-runtime-state-capture'
      )) as { type: string; id: string } | undefined;
    if (captureRequest) {
      act(() => {
        window.dispatchEvent(new MessageEvent('message', {
          data: {
            type: 'od:preview-runtime-state-captured',
            id: captureRequest.id,
            state: {
              version: 1,
              hash: '',
              htmlAttrs: {},
              bodyAttrs: {},
              entries: [],
            },
          },
          source: initialFrame.contentWindow,
        }));
      });
    }

    await waitFor(() => {
      expect(screen.getByTestId('manual-edit-mode-toggle').getAttribute('aria-pressed')).toBe('true');
      const activeFrame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
      expect(activeFrame.getAttribute('data-od-active')).toBe('true');
      expect(activeFrame.getAttribute('data-od-render-mode')).toBe('srcdoc');
    });
  }

  async function hoverManualEditTarget(target = heroTarget()) {
    const frame = await previewFrame();
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'od-edit-hover', target },
        source: frame.contentWindow,
      }));
    });
    // Hover only surfaces the affordance; it must not open any panel.
    await waitFor(() => {
      expect(screen.getByTestId('manual-edit-hover-open')).toBeTruthy();
    });
  }

  // Clicking the empty canvas is the gesture that opens the compact page card.
  async function clickManualEditBackground() {
    const frame = await previewFrame();
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'od-edit-background' },
        source: frame.contentWindow,
      }));
    });
    await waitFor(() => {
      expect(document.querySelector('.manual-edit-right')).not.toBeNull();
    });
  }

  // Hover only surfaces the "edit params" affordance; pinning the inspector to
  // a target now requires an explicit click (mirrors clicking that affordance
  // or a container/image body in the bridge).
  async function selectManualEditTarget(target = heroTarget()) {
    const frame = await previewFrame();
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'od-edit-select', target },
        source: frame.contentWindow,
      }));
    });
    await waitFor(() => {
      expect(document.querySelector('.manual-edit-right')).not.toBeNull();
    });
  }

  // Parameter rows are addressed by their localized `.cc-label`, matching the
  // rewritten panel's single "Parameters" list (the old hardcoded TYPOGRAPHY /
  // SIZE / LAYOUT / BOX group headers are gone).
  async function findStyleInput(label: string) {
    return waitFor(() => {
      const input = Array.from(document.querySelectorAll('.cc-row'))
        .find((row) => row.querySelector('.cc-label')?.textContent === label)
        ?.querySelector('input') as HTMLInputElement | null;
      if (!input) throw new Error(`${label} input not found`);
      return input;
    });
  }

  const FONT_SIZE_ROW = 'Font size';

  // The bridge posts this once a free drag-to-reposition passes the 4px
  // threshold and the pointer is released; the transform it carries is the
  // element's new translate().
  async function dropManualEditDrag(id: string, transform: string) {
    const frame = await previewFrame();
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'od-edit-drag-commit', id, transform },
        source: frame.contentWindow,
      }));
    });
  }

  it('removes invalid fields from pending manual edit style saves without dropping unrelated fields', () => {
    expect(cancelManualEditPendingStyleSnapshot({
      id: 'hero',
      label: 'Style: Hero',
      version: 1,
      styles: { fontSize: '4px', color: '#111111' },
    }, 'hero', ['fontSize'])).toEqual({
      id: 'hero',
      label: 'Style: Hero',
      version: 1,
      styles: { color: '#111111' },
    });

    expect(cancelManualEditPendingStyleSnapshot({
      id: 'hero',
      label: 'Style: Hero',
      version: 1,
      styles: { fontSize: '4px' },
    }, 'hero', ['fontSize'])).toBeNull();

    const otherTargetPending = {
      id: 'hero',
      label: 'Style: Hero',
      version: 1,
      styles: { fontSize: '4px' },
    };
    expect(cancelManualEditPendingStyleSnapshot(otherTargetPending, 'cta', ['fontSize'])).toBe(otherTargetPending);
  });

  it.each([false, true])('flushes the panel draft before safe exit and retains it after a failed write (failure: %s)', async (failFirst) => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    const saved: string[] = [];
    let exit: (() => Promise<boolean>) | null = null;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('/api/projects/project-1/files') && init?.method === 'POST') {
        saved.push(String(init.body));
        if (failFirst && saved.length === 1) {
          return new Response(JSON.stringify({ error: { message: 'disk full' } }), {
            status: 500, headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } });
    }));
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
      liveHtml={source} onManualEditExitHandlerChange={(_file, handler) => { exit = handler; }} />);
    await enterManualEditMode();
    await selectManualEditTarget();
    const textarea = document.querySelector('.manual-edit-right textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Preserved panel draft' } });
    expect(exit).not.toBeNull();
    let accepted: boolean | undefined;
    await act(async () => { accepted = await exit!(); });
    expect(saved).toHaveLength(1);
    expect(JSON.parse(saved[0]!).content).toContain('<main data-od-id="hero">Preserved panel draft</main>');
    expect(accepted).toBe(!failFirst);
    if (failFirst) {
      expect(screen.getByTestId('manual-edit-mode-toggle').getAttribute('aria-pressed')).toBe('true');
      expect((document.querySelector('.manual-edit-right textarea') as HTMLTextAreaElement).value).toBe('Preserved panel draft');
      expect(screen.getByText(/Could not save the edited file/)).toBeTruthy();
      await act(async () => { accepted = await exit!(); });
      expect(accepted).toBe(true);
      expect(saved).toHaveLength(2);
      expect(JSON.parse(saved[1]!).content).toContain('Preserved panel draft');
    }
    expect(screen.getByTestId('manual-edit-mode-toggle').getAttribute('aria-pressed')).toBe('false');
  });

  it.each([
    ['close', false], ['close', true], ['select', false], ['select', true], ['background', false], ['background', true],
  ] as const)('preserves properties drafts on %s (first write fails: %s)', async (action, failFirst) => {
    const source = '<html><body><main data-od-id="hero">Hero</main><p data-od-id="other">Other</p></body></html>';
    const saved: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('/api/projects/project-1/files') && init?.method === 'POST') {
        saved.push(String(init.body));
        return new Response(JSON.stringify(saved.length === 1 && failFirst
          ? { error: { message: 'disk full' } } : { file: htmlPreviewFile() }), {
          status: saved.length === 1 && failFirst ? 500 : 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(source, { status: 200 });
    }));
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={source} />);
    await enterManualEditMode();
    await selectManualEditTarget();
    const textarea = () => document.querySelector('.manual-edit-right textarea') as HTMLTextAreaElement | null;
    fireEvent.change(textarea()!, { target: { value: 'Kept across selection' } });
    // Duplicate bridge reports must preserve the unsaved draft without writing.
    await selectManualEditTarget();
    expect(textarea()!.value).toBe('Kept across selection');
    expect(saved).toHaveLength(0);
    const change = async () => {
      if (action === 'close') fireEvent.click(screen.getByLabelText('Close edit panel'));
      else if (action === 'background') {
        const frame = await previewFrame();
        act(() => { window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { type: 'od-edit-background' } })); });
      }
      else await selectManualEditTarget({ ...heroTarget(), id: 'other', label: 'Other', text: 'Other',
        fields: { text: 'Other' }, tagName: 'p', outerHtml: '<p data-od-id="other">Other</p>' });
    };
    await change();
    await waitFor(() => expect(saved).toHaveLength(1));
    if (failFirst) {
      await screen.findByText(/Could not save the edited file/);
      expect(textarea()!.value).toBe('Kept across selection');
      await change();
      await waitFor(() => expect(saved).toHaveLength(2));
    }
    await waitFor(() => expect(textarea()?.value ?? null).toBe(action !== 'select' ? null : 'Other'));
    for (const body of saved) expect(JSON.parse(body).content).toContain('<main data-od-id="hero">Kept across selection</main>');
    expect(screen.getByTestId('manual-edit-mode-toggle').getAttribute('aria-pressed')).toBe('true');
  });

  it.each(['apply', 'undo', 'redo'] as const)('binds %s to its observed source and rejects a concurrent writer', async (operation) => {
    const original = '<html>\r\n<body><main data-od-id="hero">Hero ☃ café</main></body>\r\n</html>';
    const concurrent = '<html><body><main data-od-id="hero">Newer agent content</main></body></html>';
    const digest = (value: string) => createHash('sha256').update(value).digest('hex');
    let persisted = original;
    let conflict = operation === 'apply';
    const writes: Array<{ content: string; expectedContentSha256?: string }> = [];
    const observed: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('/api/projects/project-1/files') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        writes.push(body);
        if (conflict) persisted = concurrent;
        if (body.expectedContentSha256 && body.expectedContentSha256 !== digest(persisted)) {
          return Response.json({ error: { code: 'FILE_CONTENT_CHANGED', message: 'Newer content exists' } }, { status: 409 });
        }
        persisted = body.content;
        return Response.json({ file: htmlPreviewFile() });
      }
      if (String(input).includes('/raw/')) observed.push(persisted);
      return new Response(persisted, { status: 200 });
    }));
    let exit: (() => Promise<boolean>) | null = null;
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={original}
      onManualEditExitHandlerChange={(_name, handler) => { exit = handler; }} />);
    await enterManualEditMode();
    await selectManualEditTarget();
    fireEvent.change(document.querySelector('.manual-edit-right textarea')!, { target: { value: 'Human edit' } });
    if (operation === 'apply') {
      let accepted: boolean | undefined;
      await act(async () => { accepted = await exit!(); });
      expect(accepted).toBe(false);
      expect((document.querySelector('.manual-edit-right textarea') as HTMLTextAreaElement).value).toBe('Human edit');
    } else {
      fireEvent.click(screen.getByText('Save'));
      await waitFor(() => expect(document.querySelector('.manual-edit-right')).toBeNull());
      await selectManualEditTarget();
      if (operation === 'redo') {
        fireEvent.click(screen.getByLabelText('Undo'));
        await waitFor(() => expect((screen.getByLabelText('Redo') as HTMLButtonElement).disabled).toBe(false));
      }
      conflict = true;
      fireEvent.click(screen.getByLabelText(operation === 'undo' ? 'Undo' : 'Redo'));
    }
    await screen.findByText(/Newer content exists/);
    expect(writes).toHaveLength(operation === 'apply' ? 1 : operation === 'undo' ? 2 : 3);
    expect(persisted).toBe(concurrent);
    expect(writes[0]!.expectedContentSha256).toBe(digest(original));
    if (operation !== 'apply') expect(writes[1]!.expectedContentSha256).toBe(digest(writes[0]!.content));
    if (operation === 'redo') expect(writes[2]!.expectedContentSha256).toBe(digest(original));
    expect(observed).not.toContain(concurrent); // The competing change happened after preflight.
    expect(screen.getByTestId('manual-edit-mode-toggle').getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the draft and refuses a write when the source observation is unavailable', async () => {
    const source = '<html><body><main data-od-id="hero">Hero</main></body></html>';
    let unavailable = false;
    const writes: string[] = [];
    let exit: (() => Promise<boolean>) | null = null;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('/api/projects/project-1/files') && init?.method === 'POST') { writes.push(String(init.body)); return Response.json({ file: htmlPreviewFile() }); }
      if (unavailable && String(input).includes('/raw/')) return new Response('Unavailable', { status: 503 });
      return new Response(source, { status: 200 });
    }));
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()} liveHtml={source}
      onManualEditExitHandlerChange={(_name, handler) => { exit = handler; }} />);
    await enterManualEditMode();
    await selectManualEditTarget();
    fireEvent.change(document.querySelector('.manual-edit-right textarea')!, { target: { value: 'Keep this draft' } });
    unavailable = true;
    let accepted: boolean | undefined;
    await act(async () => { accepted = await exit!(); });
    expect(accepted).toBe(false);
    expect(writes).toHaveLength(0);
    expect((document.querySelector('.manual-edit-right textarea') as HTMLTextAreaElement).value).toBe('Keep this draft');
    expect(screen.getByText(/Could not check the latest file/)).toBeTruthy();
  });

  it('opens edit mode with a clean canvas and no docked panel', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    ));

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    // No panel auto-pops; the canvas stays clean.
    expect(document.querySelector('.manual-edit-right')).toBeNull();
    expect(screen.queryByText('PAGE')).toBeNull();

    // Hovering surfaces only the click affordance, still no panel.
    await hoverManualEditTarget();
    expect(document.querySelector('.manual-edit-right')).toBeNull();
    expect(screen.queryByText('PAGE')).toBeNull();
    expect(screen.getByTestId('manual-edit-hover-open')).toBeTruthy();
  });

  it('opens the compact page-styles card when the empty canvas is clicked', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    ));

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await clickManualEditBackground();

    expect(screen.getByText('PAGE')).toBeTruthy();
    expect(document.querySelector('.manual-edit-page-card')).not.toBeNull();
  });

  it('pins the inspector to a target only after clicking the hover affordance', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    ));

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await hoverManualEditTarget();
    // No panel until the affordance is clicked.
    expect(document.querySelector('.manual-edit-right')).toBeNull();

    fireEvent.click(screen.getByTestId('manual-edit-hover-open'));

    // Selected target inspector exposes the localized font-size control.
    await findStyleInput(FONT_SIZE_ROW);
    expect(screen.queryByText('PAGE')).toBeNull();
    // Affordance hides once its element is the pinned selection.
    expect(screen.queryByTestId('manual-edit-hover-open')).toBeNull();
  });

  it('does not let a pending manual edit style save survive a file switch', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('<!doctype html><html><body></body></html>', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const first = htmlPreviewFile();
    const second = { ...htmlPreviewFile(), name: 'second.html', path: 'second.html' };
    const { rerender } = render(
      <FileViewer projectId="project-1" projectKind="prototype" file={first}
        liveHtml='<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>'
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();
    const baseSizeInput = await findStyleInput(FONT_SIZE_ROW);
    fireEvent.change(baseSizeInput, { target: { value: '18' } });

    rerender(
      <FileViewer projectId="project-1" projectKind="prototype" file={second}
        liveHtml='<!doctype html><html><body><main data-od-id="second">Second</main></body></html>'
      />,
    );

    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/projects/project-1/files',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('clears loaded source immediately on file switch without liveHtml before manual edit can save', async () => {
    let secondResolve!: (value: Response) => void;
    const secondFetch = new Promise<Response>((resolve) => {
      secondResolve = resolve;
    });
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/raw/second.html')) return secondFetch;
      return new Response('<!doctype html><html><body><main data-od-id="hero">First</main></body></html>', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const first = htmlPreviewFile();
      const second = { ...htmlPreviewFile(), name: 'second.html', path: 'second.html' };
      const { rerender } = render(<FileViewer projectId="project-1" projectKind="prototype" file={first} />);

      // The raw fetch is cache-busted on every mtime / reload / files-refresh
      // bump so srcDoc-mode previews see fresh HTML after agent edits.
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/^\/api\/projects\/project-1\/raw\/preview\.html(\?|$)/),
        { cache: 'no-store' },
      ));
      await enterManualEditMode();
      await selectManualEditTarget();
      const baseSizeInput = await findStyleInput(FONT_SIZE_ROW);
      fireEvent.change(baseSizeInput, { target: { value: '18' } });

      rerender(<FileViewer projectId="project-1" projectKind="prototype" file={second} />);
      fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1100));
      });

      expect(fetchMock).not.toHaveBeenCalledWith(
        '/api/projects/project-1/files',
        expect.objectContaining({ method: 'POST' }),
      );
      secondResolve(new Response('<!doctype html><html><body><main data-od-id="second">Second</main></body></html>', { status: 200 }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears a prior manual edit save error after a later successful save', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    let saveAttempts = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        saveAttempts += 1;
        if (saveAttempts === 1) {
          return new Response(JSON.stringify({
            error: { code: 'FORBIDDEN', message: 'Request failed (403).' },
          }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/raw/preview.html')) {
        return new Response(source, { status: 200 });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();
    const baseSizeInput = await findStyleInput(FONT_SIZE_ROW);

    fireEvent.change(baseSizeInput, { target: { value: '18' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => {
      expect(screen.getByText(/Could not save the edited file/)).toBeTruthy();
    });

    fireEvent.change(baseSizeInput, { target: { value: '19' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => {
      expect(screen.queryByText(/Could not save the edited file/)).toBeNull();
    });
  });

  it('closes the inspector without saving on cancel, staying in edit mode', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    const fetchMock = vi.fn(async () =>
      new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();
    const baseSizeInput = await findStyleInput(FONT_SIZE_ROW);

    fireEvent.change(baseSizeInput, { target: { value: '18' } });
    fireEvent.click(screen.getByText('Cancel'));

    await waitFor(() => {
      expect(document.querySelector('.manual-edit-right')).toBeNull();
    });
    expect(document.querySelector('.manual-edit-workspace')).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/projects/project-1/files',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('closes the inspector after save succeeds, staying in edit mode', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();
    const baseSizeInput = await findStyleInput(FONT_SIZE_ROW);

    fireEvent.change(baseSizeInput, { target: { value: '18' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/project-1/files',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(document.querySelector('.manual-edit-right')).toBeNull();
    });
    expect(document.querySelector('.manual-edit-workspace')).not.toBeNull();
  });

  it('replies to the reloaded preview with the pre-save scroll position after a panel save (#92)', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();

    // The host cannot read a sandboxed iframe's scroll directly; the bridge
    // reports it via od:preview-scroll while the user works. Dispatch from
    // every mounted preview frame — only the active one passes the host's
    // source filter, mirroring production.
    const previewFrames = ['artifact-preview-frame', 'artifact-preview-frame-srcdoc']
      .map((testId) => screen.queryByTestId(testId) as HTMLIFrameElement | null)
      .filter((frame): frame is HTMLIFrameElement => Boolean(frame?.contentWindow));
    expect(previewFrames.length).toBeGreaterThan(0);
    act(() => {
      for (const frame of previewFrames) {
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'od:preview-scroll', frameLeft: 0, frameTop: 1234, canvasLeft: 0, canvasTop: 1234 },
          source: frame.contentWindow,
        }));
      }
    });

    // A TEXT change is a content patch: saving it rewrites the frozen source,
    // which rebuilds the srcDoc and reloads the iframe from the top (a style
    // change streams live and never reloads, so it would not cover this bug).
    const textarea = document.querySelector('.manual-edit-right textarea') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    fireEvent.change(textarea, { target: { value: 'Hero edited' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/project-1/files',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(document.querySelector('.manual-edit-right')).toBeNull();
    });

    // The reloaded document's bridge asks where to scroll back to. The reply
    // must carry the pre-save position — not the long-stale edit-entry
    // snapshot and not a zeroed fallback (#92: preview jumped to the top).
    const restoreMessages: Array<{ frameTop?: number; canvasTop?: number }> = [];
    const spies = previewFrames.map((frame) =>
      vi.spyOn(frame.contentWindow as Window, 'postMessage').mockImplementation(((message: unknown) => {
        const data = message as { type?: string; frameTop?: number; canvasTop?: number } | null;
        if (data && data.type === 'od:preview-scroll-restore') restoreMessages.push(data);
      }) as never),
    );
    try {
      act(() => {
        for (const frame of previewFrames) {
          window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'od:preview-scroll-request' },
            source: frame.contentWindow,
          }));
        }
      });
      await waitFor(() => {
        expect(restoreMessages.length).toBeGreaterThan(0);
      });
      expect(restoreMessages.some((data) => data.frameTop === 1234 && data.canvasTop === 1234)).toBe(true);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('applies a saved panel text edit to the retained iframe without waiting for a style change', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();
    const frame = await previewFrame();
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    const textarea = document.querySelector('.manual-edit-right textarea') as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: 'Hero edited' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/project-1/files',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(postMessage).toHaveBeenCalledWith({
        type: 'od-edit-preview-text',
        id: 'hero',
        value: 'Hero edited',
      }, '*');
    });
  });

  it('holds a dropped drag as a pending style and only persists it on save', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    const savedBodies: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        savedBodies.push(String(init.body));
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();
    await findStyleInput(FONT_SIZE_ROW);
    // Nothing is dirty before the drag, so no Reset is offered.
    expect(screen.queryByText('Reset')).toBeNull();

    await dropManualEditDrag('hero', 'translate(12px, 8px)');

    // The drop is a pending edit like any inspector change: nothing on disk yet,
    // but the panel is dirty so Reset/Save act on it.
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/projects/project-1/files',
      expect.objectContaining({ method: 'POST' }),
    );
    await waitFor(() => {
      expect(screen.getByText('Reset')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(savedBodies.length).toBe(1);
    });
    const payload = JSON.parse(savedBodies[0]!) as { content: string };
    expect(payload.content).toContain('translate(12px, 8px)');
  });

  it('keeps a drag on an unselected element out of the open panel draft', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main><aside data-od-id="side">Side</aside></body></html>';
    const fetchMock = vi.fn(async () =>
      new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();
    await findStyleInput(FONT_SIZE_ROW);

    // A drag commit for a different element must not dirty the panel that is
    // showing `hero` — otherwise Save would write someone else's transform
    // into this element's draft.
    await dropManualEditDrag('side', 'translate(40px, 0px)');

    expect(screen.queryByText('Reset')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/projects/project-1/files',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('saves text typed in the inspector while an inline text session is active', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    const savedBodies: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        savedBodies.push(String(init.body));
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();
    const frame = await previewFrame();
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'od-edit-text-session', id: 'hero', active: true },
        source: frame.contentWindow,
      }));
    });

    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Edited from panel' } });
    fireEvent.click(screen.getByText('Save'));
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'od-edit-text-session',
          id: 'hero',
          active: false,
          changed: false,
          committed: false,
        },
        source: frame.contentWindow,
      }));
    });

    await waitFor(() => {
      expect(savedBodies.length).toBe(1);
    });
    const payload = JSON.parse(savedBodies[0]!) as { content: string };
    expect(payload.content).toContain('<main data-od-id="hero">Edited from panel</main>');
    expect(payload.content).not.toContain('<main data-od-id="hero">Hero</main>');
  });

  it('keeps the preview mounted and does not save when deleting the only rendered root', async () => {
    const source = '<!doctype html><html><body><main data-od-id="app-root">App</main><script>window.bootApp && window.bootApp();</script></body></html>';
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget({
      ...heroTarget(),
      id: 'app-root',
      label: 'App root',
      text: 'App',
      outerHtml: '<main data-od-id="app-root">App</main>',
    });

    fireEvent.click(screen.getByLabelText('Delete element'));

    await waitFor(() => {
      expect(screen.getByText('Cannot remove the last rendered element in the document.')).toBeTruthy();
    });
    expect((screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement).srcdoc).toContain('data-od-id="app-root"');
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/projects/project-1/files',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

function heroTarget(): ManualEditTarget {
  return {
    id: 'hero',
    kind: 'text',
    label: 'Hero',
    tagName: 'main',
    className: '',
    text: 'Hero',
    rect: { x: 24, y: 24, width: 160, height: 48 },
    fields: { text: 'Hero' },
    attributes: { 'data-od-id': 'hero' },
    styles: emptyManualEditStyles(),
    isLayoutContainer: false,
    outerHtml: '<main data-od-id="hero">Hero</main>',
  };
}

function htmlPreviewFile(): ProjectFile {
  return {
    name: 'preview.html',
    path: 'preview.html',
    type: 'file',
    size: 1024,
    mtime: 1710000000,
    mime: 'text/html',
    kind: 'html',
    artifactManifest: {
      version: 1,
      kind: 'html',
      title: 'Preview',
      entry: 'preview.html',
      renderer: 'html',
      exports: ['html'],
    },
  };
}
