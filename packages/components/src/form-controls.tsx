import { createContext, forwardRef, useContext } from 'react';
import type { ForwardedRef, ReactElement, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

import { joinClassNames } from './class-names';
import styles from './form-controls.module.css';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;
/** Null retains the original renderer for input types a host does not adapt. */
export type InputRenderer = (props: InputProps, ref: ForwardedRef<HTMLInputElement>) => ReactElement | null;
const InputRendererContext = createContext<InputRenderer | null>(null);
export const InputRendererProvider = InputRendererContext.Provider;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref,
) {
  const render = useContext(InputRendererContext);
  const override = render?.({ ...props, className }, ref);
  if (override) return override;
  return <input ref={ref} className={joinClassNames(styles.control, className)} {...props} />;
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Preserve a caller's native presentation when no host renderer is active. */
  unstyled?: boolean;
};
export type TextareaRenderer = (props: TextareaHTMLAttributes<HTMLTextAreaElement>, ref: ForwardedRef<HTMLTextAreaElement>) => ReactElement | null;
const TextareaRendererContext = createContext<TextareaRenderer | null>(null);
export const TextareaRendererProvider = TextareaRendererContext.Provider;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, unstyled = false, ...props },
  ref,
) {
  const render = useContext(TextareaRendererContext);
  const override = render?.({ ...props, className }, ref);
  if (override) return override;
  return <textarea ref={ref} className={unstyled ? className : joinClassNames(styles.control, styles.textarea, className)} {...props} />;
});

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, ...props },
  ref,
) {
  return <select ref={ref} className={joinClassNames(styles.control, styles.select, className)} {...props} />;
});
