// @vitest-environment jsdom
import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, ButtonRendererProvider, Input, InputRendererProvider, Textarea, TextareaRendererProvider, ValueSelect, ValueSelectRendererProvider } from '@open-design/components';
import { TextareaBase } from '../../../src/components/embedded/boardui/textarea';
import { renderEmbeddedButton, renderEmbeddedInput, renderEmbeddedTextarea, renderEmbeddedValueSelect } from '../../../src/components/embedded/boardui/controls';
afterEach(cleanup);
describe('embedded BoardUI controls', () => {
  it('changes an embedded choice through an explicit value callback', async () => {
    const change = vi.fn();
    render(<ValueSelectRendererProvider value={renderEmbeddedValueSelect}>
      <ValueSelect id="weight" label="Weight" value="400" options={[{ value: '400', label: '400' }, { value: '700', label: '700' }]} onValueChange={change} />
    </ValueSelectRendererProvider>);
    const trigger = screen.getByRole('button', { name: /Weight/ });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyUp(trigger, { key: 'ArrowDown' });
    const option = await screen.findByRole('option', { name: '700' });
    fireEvent.click(option);
    expect(change).toHaveBeenCalledWith('700');
  });
  it('keeps empty/custom choices and focus callbacks in live editor rows', () => {
    const focus = vi.fn();
    render(<ValueSelectRendererProvider value={renderEmbeddedValueSelect}>
      <ValueSelect id="custom-font" label="Font" hideLabel value="" onFocus={focus} options={[{ value: '', label: 'Inherited font' }, { value: 'Custom font', label: 'Custom font' }]} onValueChange={() => {}} />
    </ValueSelectRendererProvider>);
    const trigger = screen.getByRole('button', { name: /Font/ });
    expect(trigger).toHaveTextContent('Inherited font');
    act(() => trigger.focus());
    expect(focus).toHaveBeenCalled();
  });
  it('retains a labelled native select outside the embedded provider', () => {
    const change = vi.fn();
    render(<ValueSelect id="alignment" label="Alignment" value="left" options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]} onValueChange={change} />);
    const select = screen.getByRole('combobox', { name: 'Alignment' });
    fireEvent.change(select, { target: { value: 'right' } });
    expect(change).toHaveBeenCalledWith('right');
  });

  it('preserves multiline edits, rows, native refs and explicit textarea sizing', () => {
    const ref = createRef<HTMLTextAreaElement>();
    const change = vi.fn();
    render(<TextareaRendererProvider value={renderEmbeddedTextarea}>
      <Textarea ref={ref} aria-label="Artifact feedback" rows={4} defaultValue="First line" onChange={change} style={{ height: '90px' }} />
    </TextareaRendererProvider>);
    const field = screen.getByRole('textbox', { name: 'Artifact feedback' });
    expect(ref.current).toBe(field);
    expect(field).toHaveAttribute('rows', '4');
    expect(field).toHaveStyle({ height: '90px' });
    fireEvent.change(field, { target: { value: 'First line\nSecond line' } });
    expect(change).toHaveBeenCalledOnce();
    expect(change.mock.calls[0]?.[0].target).toBe(field);
    expect(field).toHaveValue('First line\nSecond line');
  });
  it('restores explicit caller dimensions when leaving autosize mode', () => {
    const style = { height: 90, maxHeight: 120, overflowY: 'auto' as const };
    const { rerender } = render(<TextareaBase aria-label="Sized notes" rows={4} autoResize style={style} />);
    const field = screen.getByRole('textbox', { name: 'Sized notes' });
    expect(field.style.height).not.toBe('90px');
    rerender(<TextareaBase aria-label="Sized notes" rows={4} autoResize={false} style={style} />);
    expect(field).toHaveStyle({ height: '90px', maxHeight: '120px', overflowY: 'auto' });
  });
  it('leaves the standalone unstyled textarea DOM presentation intact', () => {
    render(<Textarea unstyled aria-label="Standalone notes" className="existing-notes" />);
    expect(screen.getByRole('textbox', { name: 'Standalone notes' }).className).toBe('existing-notes');
  });

  it('keeps native input change events, refs, labels and constraints', () => {
    const ref = createRef<HTMLInputElement>();
    const change = vi.fn();
    render(<InputRendererProvider value={renderEmbeddedInput}>
      <label htmlFor="artifact-title">Artifact title</label>
      <Input id="artifact-title" ref={ref} onChange={change} defaultValue="Original" maxLength={160} required />
    </InputRendererProvider>);
    const input = screen.getByRole('textbox', { name: 'Artifact title' });
    expect(ref.current).toBe(input);
    expect(input).toHaveAttribute('maxlength', '160');
    expect(input).toBeRequired();
    fireEvent.change(input, { target: { value: 'Revised' } });
    expect(change).toHaveBeenCalledOnce();
    expect(change.mock.calls[0]?.[0].target).toBe(input);
    expect(input).toHaveValue('Revised');
  });
  it('retains disabled text fields and the native file chooser fallback', () => {
    render(<InputRendererProvider value={renderEmbeddedInput}>
      <Input aria-label="Disabled title" disabled />
      <Input type="file" aria-label="Upload artifact" accept="image/png" />
    </InputRendererProvider>);
    expect(screen.getByRole('textbox', { name: 'Disabled title' })).toBeDisabled();
    const file = screen.getByLabelText('Upload artifact');
    expect(file).toHaveAttribute('type', 'file');
    expect(file).toHaveAttribute('accept', 'image/png');
    expect(file.closest('[role="group"]')).toBeNull();
  });

  it('keeps icon content, button refs and click handlers through the adapter', () => {
    const ref = createRef<HTMLButtonElement>();
    const click = vi.fn();
    render(<ButtonRendererProvider value={renderEmbeddedButton}><Button size="icon" ref={ref} aria-label="Inspect" onClick={click}><i data-testid="inspect-icon" /></Button></ButtonRendererProvider>);
    const button = screen.getByRole('button', { name: 'Inspect' });
    expect(ref.current).toBe(button);
    expect(screen.getByTestId('inspect-icon')).toBeInTheDocument();
    expect(button).toHaveClass('font-sans');
    fireEvent.click(button);
    expect(click).toHaveBeenCalledOnce();
  });
  it('preserves disabled and submit semantics', () => {
    render(<ButtonRendererProvider value={renderEmbeddedButton}><Button type="submit" variant="primary" disabled>Save</Button></ButtonRendererProvider>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'submit');
  });
});
