import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConnectionManager } from '../connection-manager';

class FakeNetworkMonitor {
  private restored: Array<() => void> = [];
  private lost: Array<() => void> = [];
  private online = true;
  onRestored(cb: () => void) { this.restored.push(cb); }
  onLost(cb: () => void) { this.lost.push(cb); }
  isOnline() { return this.online; }
  start() {}
  stop() {}
  goOffline() { this.online = false; for (const cb of this.lost) cb(); }
  goOnline() { this.online = true; for (const cb of this.restored) cb(); }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function makeCM(connectImpl: () => Promise<void>) {
  const network = new FakeNetworkMonitor();
  const cm = new ConnectionManager({
    connect: connectImpl,
    disconnect: async () => {},
    networkMonitor: network as never,
    backoffMs: [50, 100, 200, 400, 800, 1600],
  });
  return { cm, network };
}

describe('ConnectionManager', () => {
  it('starts in disconnected, transitions to connected on first connect()', async () => {
    const { cm } = makeCM(async () => {});
    expect(cm.status()).toBe('disconnected');
    await cm.connect();
    expect(cm.status()).toBe('connected');
  });

  it('moves to reconnecting on handleDisconnect, then connected after backoff', async () => {
    const connect = vi.fn(async () => {});
    const { cm } = makeCM(connect);
    await cm.connect();
    cm.handleDisconnect('network glitch');
    expect(cm.status()).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(60);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('exponential backoff on repeated failures (50,100,200,400)', async () => {
    let fail = 4;
    const connect = vi.fn(async () => {
      if (fail-- > 0) throw new Error('nope');
    });
    const { cm } = makeCM(connect);
    try { await cm.connect(); } catch { /* expected — test verifies reconnect after failure */ }
    expect(cm.status()).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(60);
    await vi.advanceTimersByTimeAsync(110);
    await vi.advanceTimersByTimeAsync(210);
    await vi.advanceTimersByTimeAsync(420);
    expect(connect.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(cm.status()).toBe('connected');
  });

  it('pauses reconnect while offline, resumes when network returns', async () => {
    const connect = vi.fn(async () => {});
    const { cm, network } = makeCM(connect);
    await cm.connect();
    network.goOffline();
    cm.handleDisconnect('network lost');
    expect(cm.status()).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(5000);
    expect(connect).toHaveBeenCalledTimes(1);
    network.goOnline();
    await vi.advanceTimersByTimeAsync(10);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('emits status changes through onStatusChanged listener', async () => {
    const listener = vi.fn();
    const { cm } = makeCM(async () => {});
    cm.onStatusChanged(listener);
    await cm.connect();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ status: 'connecting' }));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ status: 'connected' }));
  });

  it('manualReconnect resets attempt count and forces immediate retry', async () => {
    let fail = 2;
    const connect = vi.fn(async () => { if (fail-- > 0) throw new Error('no'); });
    const { cm } = makeCM(connect);
    try { await cm.connect(); } catch { /* expected — test verifies reconnect after failure */ }
    await vi.advanceTimersByTimeAsync(60);
    const callsBefore = connect.mock.calls.length;
    cm.manualReconnect();
    expect(connect.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
