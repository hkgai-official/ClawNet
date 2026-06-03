import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { GatewayChannel } from '../gateway-channel';
import type { HelloFrame } from '../gateway-models';

class FakeWs extends EventEmitter {
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; this.emit('close', 1000, 'bye'); }
  open() { this.readyState = FakeWs.OPEN; this.emit('open'); }
  receive(json: object) { this.emit('message', Buffer.from(JSON.stringify(json))); }
}

let fakeWs: FakeWs;
let wsFactory: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fakeWs = new FakeWs();
  wsFactory = vi.fn(() => fakeWs as never);
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

function makeChannel(extra: Partial<ConstructorParameters<typeof GatewayChannel>[0]> = {}) {
  return new GatewayChannel({
    url: 'ws://gw.test/api/v1/ws',
    helloPayload: {
      type: 'hello', role: 'unified', scopes: [], caps: [], commands: [],
      permissions: {}, client_id: 'c1', client_mode: 'clawnet',
    } as HelloFrame,
    wsFactory,
    helloTimeoutMs: 100,
    pingIntervalMs: 50,
    pongTimeoutMs: 100,
    ...extra,
  });
}

describe('GatewayChannel.connect', () => {
  it('opens WS, sends hello, resolves on hello_ok', async () => {
    const ch = makeChannel();
    const connectPromise = ch.connect();
    fakeWs.open();
    expect(JSON.parse(fakeWs.sent[0]!).type).toBe('hello');
    fakeWs.receive({ type: 'hello_ok', protocol: 'v1' });
    await expect(connectPromise).resolves.toBeUndefined();
    expect(ch.isConnected()).toBe(true);
  });

  it('rejects if hello_ok doesnt arrive within timeout', async () => {
    const ch = makeChannel({ helloTimeoutMs: 50 });
    const p = ch.connect();
    fakeWs.open();
    await vi.advanceTimersByTimeAsync(80);
    await expect(p).rejects.toThrow(/hello/);
  });

  it('rejects on socket error during connect', async () => {
    const ch = makeChannel();
    const p = ch.connect();
    fakeWs.emit('error', new Error('econnrefused'));
    await expect(p).rejects.toThrow(/econnrefused/);
  });
});

describe('GatewayChannel keepalive', () => {
  it('sends ping every interval after connected', async () => {
    const ch = makeChannel({ pingIntervalMs: 50 });
    const p = ch.connect();
    fakeWs.open();
    fakeWs.receive({ type: 'hello_ok', protocol: 'v1' });
    await p;
    await vi.advanceTimersByTimeAsync(120);
    const pings = fakeWs.sent.filter((s) => JSON.parse(s).type === 'ping');
    expect(pings.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT disconnect when no pong arrives (server-proxied flow is fire-and-forget)', async () => {
    // Regression: server `/ws/v1/messages` never replies to pings (macOS
    // ServerConnection.swift:120 also doesn't gate on pong). An earlier
    // pong-timeout implementation reconnected every ~30s on a perfectly
    // healthy socket. Keepalive should send ping and never disconnect on
    // its own — only ws.onclose/onerror should surface real failures.
    const onDisconnect = vi.fn();
    const ch = makeChannel({ pingIntervalMs: 30, onDisconnect });
    const p = ch.connect();
    fakeWs.open();
    fakeWs.receive({ type: 'hello_ok', protocol: 'v1' });
    await p;
    await vi.advanceTimersByTimeAsync(500);
    expect(onDisconnect).not.toHaveBeenCalled();
    expect(ch.isConnected()).toBe(true);
  });

  it('tolerates pong frames without crashing', async () => {
    const ch = makeChannel({ pingIntervalMs: 30 });
    const p = ch.connect();
    fakeWs.open();
    fakeWs.receive({ type: 'hello_ok', protocol: 'v1' });
    await p;
    fakeWs.receive({ type: 'pong' });
    expect(ch.isConnected()).toBe(true);
  });
});

describe('GatewayChannel push dispatch', () => {
  it('forwards push frames to onPush handler', async () => {
    const onPush = vi.fn();
    const ch = makeChannel({ onPush });
    const p = ch.connect();
    fakeWs.open();
    fakeWs.receive({ type: 'hello_ok', protocol: 'v1' });
    await p;
    fakeWs.receive({ type: 'push', topic: 'chat.message', payload: { id: 'm1' } });
    expect(onPush).toHaveBeenCalledWith({
      type: 'push', topic: 'chat.message', payload: { id: 'm1' },
    });
  });

  it('ignores invalid frames without crashing', async () => {
    const onPush = vi.fn();
    const ch = makeChannel({ onPush });
    const p = ch.connect();
    fakeWs.open();
    fakeWs.receive({ type: 'hello_ok', protocol: 'v1' });
    await p;
    fakeWs.receive({ type: 'unknown', garbage: true });
    expect(onPush).not.toHaveBeenCalled();
    expect(ch.isConnected()).toBe(true);
  });
});

describe('GatewayChannel.sendRequest', () => {
  it('writes a JSON-RPC request frame to the underlying ws after connect', async () => {
    const ch = makeChannel();
    const p = ch.connect();
    fakeWs.open();
    fakeWs.receive({ type: 'hello_ok', protocol: 'v1' });
    await p;

    ch.sendRequest('node.invoke.result', { id: 'invoke-1', result: '{"ok":true}' });

    const last = JSON.parse(fakeWs.sent[fakeWs.sent.length - 1]!);
    expect(last).toEqual({
      type: 'request',
      method: 'node.invoke.result',
      params: { id: 'invoke-1', result: '{"ok":true}' },
    });
  });

  it('throws GatewayError when not connected', () => {
    const ch = makeChannel();
    expect(() => ch.sendRequest('x', { id: 'y' })).toThrow(/notConnected|not connected|cannot/i);
  });
});
