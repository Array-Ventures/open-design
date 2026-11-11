import type { ButtonRenderer, InputRenderer, TextareaRenderer, ValueSelectRenderer } from '@open-design/components';
import { Button } from './button';
import { InputBase } from './input';
import { TextareaBase } from './textarea';
import { Select, SelectItem } from './select';
import './styles.css';
import { cx } from './cx';

/** Adapt upstream props once, rather than rewriting each upstream workspace action. */
export const renderEmbeddedButton: ButtonRenderer = ({ variant = 'default', size = 'default', className, ...props }, ref) => (
  <Button
    {...props}
    ref={ref}
    className={cx((variant === 'ghost' || variant === 'subtle' || variant === 'primary-ghost') && 'border-transparent bg-transparent text-text-secondary shadow-none hover:border-transparent hover:bg-background-secondary-hover active:bg-background-secondary-default', (props['aria-pressed'] === true || props['aria-pressed'] === 'true') && 'bg-button-ghost-background text-button-ghost-foreground hover:bg-button-ghost-hover active:bg-button-ghost-hover', className)}
    iconOnly={size === 'icon'}
    variant={variant === 'primary' ? 'primary' : 'secondary'}
    size={size === 'sm' || size === 'icon' ? 'small' : 'medium'}
  />
);

/** Non-text inputs retain their specialized upstream native semantics. */
export const renderEmbeddedInput: InputRenderer = ({ type = 'text', size: _size, className, ...props }, ref) => {
  if (!['text', 'email', 'url', 'search', 'password', 'tel', 'number'].includes(type)) return null;
  return <InputBase {...props} type={type} ref={ref} fieldClassName={className} />;
};

export const renderEmbeddedTextarea: TextareaRenderer = ({ className, ...props }, ref) => (
  <TextareaBase {...props} ref={ref} className={className} />
);

export const renderEmbeddedValueSelect: ValueSelectRenderer = ({ id, label, value, options, onValueChange, disabled, hideLabel, onFocus }) => (
  <Select id={id} label={hideLabel ? undefined : label} aria-label={hideLabel ? label : undefined} onFocus={onFocus} selectedKey={value} isDisabled={disabled} onSelectionChange={key => { if (key !== null) onValueChange(String(key)); }}>
    {options.map(option => <SelectItem key={option.value} id={option.value} textValue={option.label}>{option.label}</SelectItem>)}
  </Select>
);
