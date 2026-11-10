import { expect, it } from 'vitest';
import { EmbeddedWriteGate } from '../../src/embedded-files/write-gate.js';

it('blocks admission and reports existing writes until they actually finish', () => {
  const gate = new EmbeddedWriteGate();
  const finish = gate.enterWrite()!;
  const lease = gate.acquire('backup')!;
  expect(lease).toMatchObject({ activeWrites: 1, requestsDrained: false });
  expect(gate.enterWrite()).toBeNull();
  finish(); finish();
  expect(gate.status('backup', lease.epoch)).toMatchObject({ activeWrites: 0, requestsDrained: true });
  expect(gate.acquire('other')).toBeNull();
  expect(gate.release('other', lease.epoch)).toBe(false);
  expect(gate.release('backup', lease.epoch)).toBe(true);
  expect(gate.enterWrite()).toBeTypeOf('function');
});

it('renews the same fence but never revives an expired heartbeat', () => {
  let now = 0; const gate = new EmbeddedWriteGate(() => now, 100);
  const lease = gate.acquire('backup')!;
  now = 90;
  expect(gate.acquire('backup', lease.epoch)).toMatchObject({ epoch: lease.epoch, expiresInMs: 100 });
  now = 191;
  expect(gate.acquire('backup', lease.epoch)).toBeNull();
  expect(gate.status('backup', lease.epoch)).toBeNull();
  const next = gate.acquire('backup')!;
  expect(next.epoch).toBeGreaterThan(lease.epoch);
  expect(gate.release('backup', lease.epoch)).toBe(false);
  expect(gate.status('backup', next.epoch)).not.toBeNull();
});

it('reopens admission when an abandoned coordinator lease expires', () => {
  let now = 0; const gate = new EmbeddedWriteGate(() => now, 100);
  gate.acquire('abandoned');
  now = 100;
  expect(gate.enterWrite()).toBeTypeOf('function');
});

it('keeps uncertain requests outstanding across lease expiry and reacquisition', () => {
  let now = 0; const gate = new EmbeddedWriteGate(() => now, 100);
  gate.enterWrite();
  gate.acquire('first'); now = 101;
  expect(gate.acquire('second')).toMatchObject({ activeWrites: 1, requestsDrained: false });
});
