import { defaultTheme, type Theme } from '@univerjs/presets';

/** The library's chrome consumes the same semantic colors as its BoardUI host.
 * Workbook content colors remain in the separate model adapter. */
export function workbookGridTheme(root: HTMLElement): Theme {
  const computed = getComputedStyle(root), theme = structuredClone(defaultTheme);
  for (const shade of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const) {
    const value = computed.getPropertyValue(`--color-accent-${shade}`).trim();
    if (value) theme.primary[shade] = value;
  }
  const gray = { 0: 'background-primary-default', 50: 'background-secondary-default', 100: 'background-tertiary-default', 200: 'separator-border', 300: 'border-button-default',
    400: 'text-placeholder', 500: 'text-tertiary', 600: 'text-secondary', 700: 'text-secondary', 800: 'text-primary', 900: 'text-primary', 1000: 'text-primary' } as const;
  for (const [shade, token] of Object.entries(gray)) {
    const value = computed.getPropertyValue(`--color-${token}`).trim();
    if (value) theme.gray[Number(shade) as keyof typeof theme.gray] = value;
  }
  return theme;
}
