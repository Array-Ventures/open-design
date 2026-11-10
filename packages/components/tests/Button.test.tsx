// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRef } from 'react';
import { Button, ButtonRendererProvider } from '../src/button';

afterEach(() => {
  cleanup();
});

describe('Button', () => {
  it('preserves native caller classes when an unstyled button has no host provider', () => {
    render(<Button unstyled className="existing-footer" variant="primary" size="sm">Save original</Button>);
    const button = screen.getByRole('button', { name: 'Save original' });
    expect(button.className).toBe('existing-footer');
    expect(button.hasAttribute('unstyled')).toBe(false);
    expect(button.hasAttribute('variant')).toBe(false);
  });

  it('lets the host replace presentation while retaining refs, actions and form semantics', () => {
    const clicked = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    render(<>
      <ButtonRendererProvider value={({ variant: _variant, size: _size, ...props }, forwardedRef) => <button {...props} ref={forwardedRef} data-host-control="true" />}>
        <Button ref={ref} type="submit" onClick={clicked} aria-label="Host save">Save</Button>
      </ButtonRendererProvider>
      <Button>Standalone action</Button>
    </>);
    const host = screen.getByRole('button', { name: 'Host save' });
    expect(ref.current).toBe(host);
    expect(host.getAttribute('type')).toBe('submit');
    fireEvent.click(host);
    expect(clicked).toHaveBeenCalledOnce();
    expect(host.getAttribute('data-host-control')).toBe('true');
    expect(screen.getByRole('button', { name: 'Standalone action' }).hasAttribute('data-host-control')).toBe(false);
  });

  it('renders a type=button by default so it never submits an enclosing form', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('type')).toBe('button');
  });

  it('accepts the chat secondary variant and sm size without leaking legacy global classes', () => {
    render(
      <Button variant="secondary" size="sm">
        Retry
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Retry' });
    // Legacy compat classes (`primary`, `ghost`, `icon-btn`, …) are frozen; new
    // variants/sizes must not add to that surface.
    for (const legacy of ['primary', 'primary-ghost', 'ghost', 'subtle', 'icon-btn']) {
      expect(button.classList.contains(legacy)).toBe(false);
    }
  });

  it('keeps the caller className and disabled state', () => {
    render(
      <Button className="extra" disabled>
        Send
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(button.classList.contains('extra')).toBe(true);
    expect(button.disabled).toBe(true);
  });
});
