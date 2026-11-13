// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DeckSlideBackground } from '../../../src/components/embedded/DeckSlideBackground';
const source = '<deck-stage><section class="slide">One</section><section class="slide">Two</section></deck-stage>';
afterEach(cleanup);

it('saves the chosen color only after confirmation, targeting the selected slide', async () => {
  const onChange = vi.fn();
  render(<DeckSlideBackground source={source} index={1} count={2} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button',{name:'Slide background'}));
  const field = await screen.findByRole('textbox',{name:'Hex value'});
  fireEvent.change(field,{target:{value:'#123456'}}); fireEvent.blur(field);
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:/^Save$/}));
  await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
  expect(onChange).toHaveBeenCalledWith(source.replace('class="slide">Two','class="slide" style="background-color: #123456 !important;">Two'),'Slide background');
});
it('cancels drafts without changing the source', async () => {
  const onChange = vi.fn();
  render(<DeckSlideBackground source={source} index={0} count={2} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button',{name:'Slide background'}));
  const field = await screen.findByRole('textbox',{name:'Hex value'});
  fireEvent.change(field,{target:{value:'#123456'}}); fireEvent.blur(field);
  fireEvent.click(screen.getByRole('button',{name:/^Cancel$/}));
  expect(onChange).not.toHaveBeenCalled();
});
it.each(['source','slide'] as const)('blocks confirmation after the %s changes while the picker is open', async change => {
  const onChange = vi.fn(), props = {source,index:0,count:2,onChange};
  const view = render(<DeckSlideBackground {...props} />);
  fireEvent.click(screen.getByRole('button',{name:'Slide background'}));
  await screen.findByRole('textbox',{name:'Hex value'});
  view.rerender(<DeckSlideBackground {...props} source={change === 'source' ? source.replace('One','Updated') : source} index={change === 'slide' ? 1 : 0} />);
  expect(screen.getByRole('status').textContent).toContain('The slide changed');
  expect((screen.getByRole('button',{name:/^Save$/}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:/^Save$/}));
  expect(onChange).not.toHaveBeenCalled();
});
it('refuses unsupported or mismatched runtime slide mappings', () => {
  const props = {source,index:0,count:3,onChange:vi.fn()};
  const view = render(<DeckSlideBackground {...props} />);
  expect((screen.getByRole('button',{name:'Slide background'}) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<DeckSlideBackground {...props} source="<main>App</main>" count={1} />);
  expect((screen.getByRole('button',{name:'Slide background'}) as HTMLButtonElement).disabled).toBe(true);
});
it.each([['red','#ff0000'],['transparent','#00000000']])('preserves an untouched %s background without a white fallback', async (color,display) => {
  const onChange=vi.fn(), html=source.replace('class="slide">One',`class="slide" style="background-color:${color}">One`);
  render(<DeckSlideBackground source={html} index={0} count={2} onChange={onChange} />);
  const trigger=screen.getByRole('button',{name:'Slide background'});
  expect(trigger.textContent?.toLowerCase()).toBe(display);
  fireEvent.click(trigger);
  await screen.findByRole('textbox',{name:'Hex value'});
  const save=screen.getByRole('button',{name:/^Save$/});
  expect((save as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(save);expect(onChange).not.toHaveBeenCalled();
});
it('refuses unresolved contextual colors instead of guessing white', () => {
  const html=source.replace('class="slide">One','class="slide" style="background-color:var(--brand)">One');
  render(<DeckSlideBackground source={html} index={0} count={2} onChange={vi.fn()} />);
  const trigger=screen.getByRole('button',{name:'Slide background'});
  expect(trigger.textContent).toBe('Custom color');
  expect((trigger as HTMLButtonElement).disabled).toBe(true);
  expect(trigger.getAttribute('aria-describedby')).not.toBeNull();
});
