export const documentDateAttributes = ['data-eve-document-date', 'datetime', 'data-eve-date-locale'] as const;
/** Persisted date content is data, never an editor permission or executable format. */
export type DocumentDate = Readonly<{ iso: string; label: string; locale: string }>;
export function documentDateIso(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]! ? value : null;
}
export function documentDateLocale(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 100) return null;
  try { return Intl.getCanonicalLocales(value)[0] === value ? value : null; } catch { return null; }
}
export function readDocumentDate(value: unknown): DocumentDate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (!documentDateIso(data.iso) || !documentDateLocale(data.locale) || typeof data.label !== 'string'
    || !data.label.trim() || data.label.length > 128 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029<>\uD800-\uDFFF]/u.test(data.label)) return null;
  return Object.freeze({ iso: data.iso as string, label: data.label, locale: data.locale as string });
}
