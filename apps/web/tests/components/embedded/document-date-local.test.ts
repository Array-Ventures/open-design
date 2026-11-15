// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { resetLocalTimeZone, setLocalTimeZone } from '@internationalized/date';
import { localDocumentDate } from '../../../src/components/embedded/document/document-date-commands';
afterEach(() => { resetLocalTimeZone(); vi.useRealTimers(); });
it('uses the local calendar day across UTC midnight and retains valid leap days', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-15T01:00:00Z'));
  setLocalTimeZone('America/Los_Angeles'); expect(localDocumentDate('en-US')).toEqual({ iso: '2026-11-14', label: 'Nov 14, 2026', locale: 'en-US' });
  setLocalTimeZone('Asia/Tokyo'); expect(localDocumentDate('en-US').iso).toBe('2026-11-15');
  expect(localDocumentDate('en-US', '2024-02-29').label).toBe('Feb 29, 2024');
  expect(() => localDocumentDate('en-US', '2023-02-29')).toThrow();
});
