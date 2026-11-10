/** Embedded-only seam: upstream components keep their semantic variable names. */
const colorMappings = {
  'background-full': ['--bg-app', '--entry-ground'],
  'background-primary-default': ['--bg', '--bg-elevated', '--glass-regular'],
  'background-primary-hover': ['--bg-fill-tertiary'],
  'background-secondary-default': ['--bg-panel'],
  'background-secondary-hover': ['--bg-fill-secondary'],
  'background-tertiary-default': ['--bg-subtle', '--bg-fill'],
  'text-primary': ['--text-strong', '--select-ink'],
  'text-secondary': ['--text', '--text-muted'],
  'text-tertiary': ['--text-soft'],
  'text-placeholder': ['--text-faint'],
  'text-on-accent': ['--accent-contrast'],
  'border-button-default': ['--border'],
  'border-button-hover': ['--border-strong', '--border-selected'],
  'separator-border': ['--border-soft', '--border-subtle'],
  'border-focus-ring': ['--focus-ring'],
  'accent-50': ['--accent-tint', '--brand-soft'],
  'accent-100': ['--accent-soft', '--brand-weak'],
  'accent-500': ['--accent', '--brand'],
  'accent-600': ['--accent-hover'],
  'accent-700': ['--accent-strong', '--brand-text', '--brand-ink'],
} as const;

const accentRampKeys = ['accent-200', 'accent-300', 'accent-400', 'accent-800', 'accent-900', 'accent-950'] as const;
type AccentRamp = Record<typeof accentRampKeys[number], string>;
type HostTheme = { mode: 'light' | 'dark'; colors: Record<keyof typeof colorMappings, string>; accentRamp?: AccentRamp };
const validColor = (color: unknown, supportsColor: (value: string) => boolean): color is string =>
  typeof color === 'string' && color.length > 0 && color.length <= 256 && !/[;{}]|var\(|url\(/i.test(color) && supportsColor(color);

export function parseHostTheme(value: unknown, supportsColor: (value: string) => boolean): HostTheme | null {
  if (!value || typeof value !== 'object') return null;
  const { mode, colors, accentRamp } = value as Partial<HostTheme>;
  if ((mode !== 'light' && mode !== 'dark') || !colors || typeof colors !== 'object' || Array.isArray(colors)) return null;
  if (Object.keys(colors).length !== Object.keys(colorMappings).length) return null;
  for (const key of Object.keys(colorMappings) as Array<keyof typeof colorMappings>) {
    const color = colors[key];
    if (!validColor(color, supportsColor)) return null;
  }
  // Additive for older hosts/companions; a supplied ramp must be complete.
  if (accentRamp !== undefined) {
    if (!accentRamp || typeof accentRamp !== 'object' || Array.isArray(accentRamp) || Object.keys(accentRamp).length !== accentRampKeys.length) return null;
    for (const key of accentRampKeys) if (!validColor(accentRamp[key], supportsColor)) return null;
  }
  return { mode, colors, ...(accentRamp === undefined ? {} : { accentRamp }) };
}

export function applyHostTheme(theme: HostTheme, root: HTMLElement): void {
  root.dataset.theme = theme.mode;
  root.dataset.hostTheme = 'boardui';
  root.style.colorScheme = theme.mode;
  for (const key of accentRampKeys) {
    if (theme.accentRamp) root.style.setProperty(`--color-${key}`, theme.accentRamp[key]);
    else root.style.removeProperty(`--color-${key}`);
  }
  for (const key of Object.keys(colorMappings) as Array<keyof typeof colorMappings>) {
    root.style.setProperty(`--color-${key}`, theme.colors[key]);
    for (const variable of colorMappings[key]) root.style.setProperty(variable, theme.colors[key]);
  }
}
