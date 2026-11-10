// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyHostTheme, parseHostTheme } from '../../../src/components/embedded/host-theme';
const keys = ['background-full', 'background-primary-default', 'background-primary-hover', 'background-secondary-default', 'background-secondary-hover', 'background-tertiary-default', 'text-primary', 'text-secondary', 'text-tertiary', 'text-placeholder', 'text-on-accent', 'border-button-default', 'border-button-hover', 'separator-border', 'border-focus-ring', 'accent-50', 'accent-100', 'accent-500', 'accent-600', 'accent-700'];
const colors = Object.fromEntries(keys.map(key => [key, '#123456']));
describe('embedded host theme boundary', () => {
  it('applies the complete optional accent ramp and clears it for an older host', () => {
    const accentRamp = Object.fromEntries([200, 300, 400, 800, 900, 950].map(step => [`accent-${step}`, '#abcdef']));
    const root = document.createElement('div');
    applyHostTheme(parseHostTheme({ mode: 'light', colors, accentRamp }, () => true)!, root);
    expect(root.style.getPropertyValue('--color-accent-400')).toBe('#abcdef');
    expect(root.style.getPropertyValue('--color-accent-950')).toBe('#abcdef');
    applyHostTheme(parseHostTheme({ mode: 'dark', colors }, () => true)!, root);
    expect(root.style.getPropertyValue('--color-accent-400')).toBe('');
    for (const ramp of [null, {}, { ...accentRamp, unexpected: '#fff' }, { ...accentRamp, 'accent-400': 'red;display:none' }, { ...accentRamp, 'accent-950': 'var(--secret)' }]) {
      expect(parseHostTheme({ mode: 'light', colors, accentRamp: ramp }, () => true)).toBeNull();
    }
    expect(parseHostTheme({ mode: 'light', colors, accentRamp }, value => value !== '#abcdef')).toBeNull();
  });
  it('maps a complete host palette without touching authored preview documents', () => {
    const theme = parseHostTheme({ mode: 'dark', colors }, () => true);
    expect(theme).not.toBeNull();
    const root = document.createElement('div');
    const authored = document.createElement('iframe');
    authored.srcdoc = '<style>body { color: red; }</style>Authored content';
    root.append(authored);
    applyHostTheme(theme!, root);
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.getPropertyValue('--bg-panel')).toBe('#123456');
    expect(root.style.getPropertyValue('--text-strong')).toBe('#123456');
    expect(root.style.getPropertyValue('--accent')).toBe('#123456');
    expect(authored.srcdoc).toBe('<style>body { color: red; }</style>Authored content');
  });
  it('rejects incomplete palettes, unsupported colors and CSS declarations', () => {
    for (const value of [null, { mode: 'system', colors }, { mode: 'light', colors: {} }, { mode: 'light', colors: { ...colors, unexpected: '#fff' } }, ...['url(https://example.invalid)', 'var(--secret)', 'red; display:none', 'x'.repeat(257)].map(color => ({ mode: 'light', colors: { ...colors, 'text-primary': color } }))]) {
      expect(parseHostTheme(value, () => true)).toBeNull();
    }
    expect(parseHostTheme({ mode: 'dark', colors }, () => false)).toBeNull();
  });
});
