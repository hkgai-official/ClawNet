import { describe, it, expect } from 'vitest';
import { ok, err, isOk, isErr, type Result } from '../result';

describe('Result', () => {
  it('ok() wraps a value', () => {
    const r: Result<number, string> = ok(42);
    expect(r.ok).toBe(true);
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
    if (r.ok) expect(r.data).toBe(42);
  });

  it('err() wraps an error code+message', () => {
    const r: Result<number, string> = err('E_BOOM', 'boom');
    expect(r.ok).toBe(false);
    expect(isOk(r)).toBe(false);
    expect(isErr(r)).toBe(true);
    if (!r.ok) {
      expect(r.error.code).toBe('E_BOOM');
      expect(r.error.message).toBe('boom');
    }
  });

  it('err() carries an optional cause', () => {
    const original = new Error('orig');
    const r = err('E_X', 'x', original);
    if (!r.ok) expect(r.error.cause).toBe(original);
  });
});
