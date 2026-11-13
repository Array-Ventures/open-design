import { createContext, useContext } from 'react';
import type { ReactElement } from 'react';
import { Select } from './form-controls';

/** Explicit value API avoids fabricating DOM change events for custom hosts. */
export interface ValueSelectProps {
  id: string;
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onValueChange(value: string): void;
  disabled?: boolean;
  hideLabel?: boolean;
  onFocus?(): void;
}
export type ValueSelectRenderer = (props: ValueSelectProps) => ReactElement;
const Renderer = createContext<ValueSelectRenderer | null>(null);
export const ValueSelectRendererProvider = Renderer.Provider;

export function ValueSelect(props: ValueSelectProps) {
  const render = useContext(Renderer);
  if (render) return render(props);
  const { id, label, value, options, onValueChange, disabled, hideLabel, onFocus } = props;
  return <>
    {hideLabel ? null : <label htmlFor={id}>{label}</label>}
    <Select id={id} aria-label={hideLabel ? label : undefined} value={value} disabled={disabled} onFocus={onFocus} onChange={event => onValueChange(event.currentTarget.value)}>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </Select>
  </>;
}
