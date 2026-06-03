import { describe, it, expect, beforeEach, vi } from 'vitest';

let lookupResult: 'ok' | 'fail' = 'ok';
vi.mock('node:dns/promises', () => ({
  default: { lookup: vi.fn(async () => {
    if (lookupResult === 'fail') throw new Error('enotfound');
    return { address: '1.1.1.1', family: 4 };
  }) },
}));

import { NetworkMonitor } from '../network-monitor';

beforeEach(() => {
  lookupResult = 'ok';
  vi.useFakeTimers();
});

describe('NetworkMonitor', () => {
  it('starts as online and reports online state', async () => {
    const m = new NetworkMonitor({ intervalMs: 1000 });
    await m.start();
    expect(m.isOnline()).toBe(true);
    m.stop();
  });

  it('fires onLost when poll fails, onRestored when poll succeeds again', async () => {
    const onLost = vi.fn();
    const onRestored = vi.fn();
    const m = new NetworkMonitor({ intervalMs: 1000 });
    m.onLost(onLost);
    m.onRestored(onRestored);
    await m.start();

    lookupResult = 'fail';
    await vi.advanceTimersByTimeAsync(1100);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(m.isOnline()).toBe(false);

    lookupResult = 'ok';
    await vi.advanceTimersByTimeAsync(1100);
    expect(onRestored).toHaveBeenCalledTimes(1);
    expect(m.isOnline()).toBe(true);

    m.stop();
  });

  it('stop() halts polling', async () => {
    const onLost = vi.fn();
    const m = new NetworkMonitor({ intervalMs: 1000 });
    m.onLost(onLost);
    await m.start();
    m.stop();
    lookupResult = 'fail';
    await vi.advanceTimersByTimeAsync(3000);
    expect(onLost).not.toHaveBeenCalled();
  });
});
