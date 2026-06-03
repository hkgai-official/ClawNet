// src/shared/domain/__tests__/update-status.test.ts
import { describe, it, expect } from 'vitest';
import { UpdateStatusSchema, UpdateStateSchema } from '../update-status';

describe('UpdateStateSchema', () => {
  it('accepts all 7 canonical states', () => {
    for (const v of ['idle', 'checking', 'no-update', 'available', 'downloading', 'downloaded', 'error']) {
      expect(UpdateStateSchema.parse(v)).toBe(v);
    }
  });
  it('rejects unknown states', () => {
    expect(() => UpdateStateSchema.parse('weird')).toThrow();
    expect(() => UpdateStateSchema.parse('downloading-cancelled')).toThrow();
  });
});

describe('UpdateStatusSchema', () => {
  it('parses idle with no optional fields', () => {
    const s = UpdateStatusSchema.parse({ state: 'idle' });
    expect(s.state).toBe('idle');
    expect(s.version).toBeUndefined();
    expect(s.error).toBeUndefined();
    expect(s.progressPercent).toBeUndefined();
  });

  it('parses available with version', () => {
    const s = UpdateStatusSchema.parse({ state: 'available', version: '0.18.1' });
    expect(s.version).toBe('0.18.1');
  });

  it('parses downloading with progressPercent', () => {
    const s = UpdateStatusSchema.parse({ state: 'downloading', version: '0.18.1', progressPercent: 42 });
    expect(s.progressPercent).toBe(42);
  });

  it('parses error with message', () => {
    const s = UpdateStatusSchema.parse({ state: 'error', error: 'ECONNRESET' });
    expect(s.error).toBe('ECONNRESET');
  });

  it('clamps progressPercent to [0, 100]', () => {
    expect(() => UpdateStatusSchema.parse({ state: 'downloading', progressPercent: -1 })).toThrow();
    expect(() => UpdateStatusSchema.parse({ state: 'downloading', progressPercent: 101 })).toThrow();
  });
});
