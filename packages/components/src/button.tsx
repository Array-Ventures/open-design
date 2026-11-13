import { createContext, forwardRef, useContext } from 'react';
import type { ButtonHTMLAttributes, ForwardedRef, ReactElement } from 'react';

import { joinClassNames } from './class-names';
import styles from './button.module.css';

export type ButtonVariant = 'default' | 'primary' | 'primary-ghost' | 'ghost' | 'subtle' | 'secondary';
export type ButtonSize = 'default' | 'icon' | 'sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Keep native caller classes outside a host presentation provider. */
  unstyled?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** Host presentation seam; handlers, refs and native button semantics remain owned by callers. */
export type ButtonRenderer = (props: ButtonProps, ref: ForwardedRef<HTMLButtonElement>) => ReactElement;
const ButtonRendererContext = createContext<ButtonRenderer | null>(null);
export const ButtonRendererProvider = ButtonRendererContext.Provider;

const variantClassNames: Record<ButtonVariant, string | undefined> = {
  default: undefined,
  primary: joinClassNames(styles.primary, 'primary'),
  'primary-ghost': joinClassNames(styles.primaryGhost, 'primary-ghost'),
  ghost: joinClassNames(styles.ghost, 'ghost'),
  subtle: joinClassNames(styles.subtle, 'subtle'),
  // chat 设计稿的 .btn.mod-secondary:白底细描边,hover 只加深描边与字色。
  // 不挂旧的全局兼容类 —— 新变体不再扩散裸 primitive 类名。
  secondary: styles.secondary,
};

const sizeClassNames: Record<ButtonSize, string | undefined> = {
  default: undefined,
  icon: joinClassNames(styles.icon, 'icon-btn'),
  // chat 设计稿的 .btn.mod-sm:26px 高、12px/600、胶囊角。设计稿里 chat 面板
  // 全部 28 个按钮都是这一档,没有一个用默认尺寸。
  sm: styles.sm,
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, type = 'button', variant = 'default', size = 'default', unstyled = false, ...props },
  ref,
) {
  const render = useContext(ButtonRendererContext);
  if (render) return render({ ...props, className, type, variant, size }, ref);
  return (
    <button
      ref={ref}
      type={type}
      className={unstyled ? className : joinClassNames(
        styles.button,
        variantClassNames[variant],
        sizeClassNames[size],
        className,
      )}
      {...props}
    />
  );
});
