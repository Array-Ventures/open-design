import { defaultTheme, type Theme } from '@univerjs/presets';

/** CanvasColorService accepts sRGB, not the lab()/oklch() values returned by
 * modern CSS. Resolve through the browser's color engine before passing tokens
 * to Univer; this changes presentation only, never workbook cell styles. */
function canvasColor(value: string, context: CanvasRenderingContext2D): string {
  context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1);
  const bytes = context.getImageData(0, 0, 1, 1).data;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'));
  return `#${hex.slice(0, bytes[3] === 255 ? 3 : 4).join('')}`;
}
const lightGray = { 0: 'background-primary-default', 50: 'background-secondary-default', 100: 'background-tertiary-default', 200: 'separator-border', 300: 'border-button-default',
  400: 'text-placeholder', 500: 'text-tertiary', 600: 'text-secondary', 700: 'text-secondary', 800: 'text-primary', 900: 'text-primary', 1000: 'text-primary' } as const;
// Univer's dark CSS swaps palette indices and its canvas inverts colors. Keep
// the palette light-to-dark in both modes, rather than inverting it twice.
const darkGray = { 0: 'text-primary', 50: 'text-primary', 100: 'text-secondary', 200: 'text-tertiary', 300: 'text-placeholder',
  400: 'border-button-default', 500: 'separator-border', 600: 'background-tertiary-default', 700: 'background-secondary-default', 800: 'background-secondary-default', 900: 'background-primary-default', 1000: 'background-primary-default' } as const;
export function workbookGridTheme(root: HTMLElement): Theme {
  const computed = getComputedStyle(root), theme = structuredClone(defaultTheme);
  let context: CanvasRenderingContext2D | null = null;
  const resolve = (token: string) => {
    const value = computed.getPropertyValue(`--color-${token}`).trim();
    if (!value) return null;
    if (!context) { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; context = canvas.getContext('2d', { willReadFrequently: true }); }
    return context ? canvasColor(value, context) : null;
  };
  for (const shade of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const) {
    const value = resolve(`accent-${shade}`); if (value) theme.primary[shade] = value;
  }
  for (const [shade, token] of Object.entries(root.dataset.theme === 'dark' ? darkGray : lightGray)) {
    const value = resolve(token); if (value) theme.gray[Number(shade) as keyof typeof theme.gray] = value;
  }
  return theme;
}
