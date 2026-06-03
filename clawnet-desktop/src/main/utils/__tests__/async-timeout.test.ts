import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withTimeout, TimeoutError } from '../async-timeout';

describe('withTimeout', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('resolves with promise value if it settles before timeout', async () => {
    const p = Promise.resolve(42);
    await expect(withTimeout(p, 1000)).resolves.toBe(42);
  });

  it('rejects with TimeoutError if promise outlasts timeout', async () => {
    const p = new Promise<number>((resolve) => setTimeout(() => resolve(1), 5000));
    const out = withTimeout(p, 1000);
    vi.advanceTimersByTime(1500);
    await expect(out).rejects.toBeInstanceOf(TimeoutError);
  });

  it('rejects with TimeoutError.message including the label when provided', async () => {
    const p = new Promise<number>(() => {});
    const out = withTimeout(p, 100, 'hello');
    vi.advanceTimersByTime(200);
    await expect(out).rejects.toThrow('hello');
  });

  it('propagates the wrapped promise rejection if it loses to the timeout race', async () => {
    const e = new Error('inner');
    const p = Promise.reject(e);
    await expect(withTimeout(p, 1000)).rejects.toBe(e);
  });
});
