import { GatewayFrameSchema, type HelloFrame, type PushFrame, type ServerMessageFrame } from './gateway-models';
import { GatewayError } from '../../core/error';

interface MinimalWs {
  readyState: number;
  send(data: string): void;
  close(): void;
  on(event: 'open' | 'message' | 'close' | 'error', listener: (...args: never[]) => void): unknown;
}

export interface GatewayChannelOptions {
  url: string;
  /** Optional hello frame. Only meaningful on the legacy paired-device
   *  endpoint that expects a `hello` followed by `hello_ok`. The current
   *  server-proxied `/ws/v1/messages` endpoint ignores it and just sends
   *  `auth_success` after validating the query-string token. Leave
   *  undefined for the standard flow; node-role registration happens via
   *  a separate `node.capabilities` envelope sent AFTER connect (see
   *  `src/main/index.ts`). */
  helloPayload?: HelloFrame;
  wsFactory?: (url: string) => MinimalWs;
  helloTimeoutMs?: number;
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
  onPush?: (frame: PushFrame) => void;
  onServerMessage?: (frame: ServerMessageFrame) => void;
  onDisconnect?: (reason: string) => void;
}

const OPEN_STATE = 1;

/** Minimal deferred: exposes resolve/reject so external callers can settle it. */
class Deferred<T = void> {
  readonly promise: Promise<T>;
  resolve!: (value: T | PromiseLike<T>) => void;
  reject!: (reason?: unknown) => void;
  private settled = false;

  constructor() {
    this.promise = new Promise<T>((res, rej) => {
      this.resolve = res;
      this.reject = rej;
    });
    // Suppress "unhandledRejection" — callers are expected to await .promise.
    this.promise.catch(() => { /* handled by caller */ });
  }

  settle(fn: () => void): void {
    if (this.settled) return;
    this.settled = true;
    fn();
  }
}

/** One entry in the WS-level diagnostic ring buffer. Captures EVERY
 *  parsed frame's type (including auth_success / pong / unparseable),
 *  giving us a frame-by-frame view of what the gateway saw. Surfaces
 *  via `__diag.recentPushes` so the prod two-user spec can tell whether
 *  a missing card is a "server didn't push" vs. "server pushed but
 *  client dropped" issue. */
export interface WsFrameDiagEntry {
  at: number;
  type: string;
}

const FRAME_LOG_MAX = 100;

export class GatewayChannel {
  private ws: MinimalWs | null = null;
  private connected = false;
  private pingTimer: NodeJS.Timeout | null = null;
  private pongTimer: NodeJS.Timeout | null = null;
  /** Pending connect deferred — kept so late-arriving rejections don't go unhandled. */
  private connectDeferred: Deferred | null = null;
  private frameLog: WsFrameDiagEntry[] = [];

  constructor(private readonly opts: GatewayChannelOptions) {}

  isConnected(): boolean { return this.connected; }
  getFrameLog(): ReadonlyArray<WsFrameDiagEntry> { return this.frameLog; }

  connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    const factory = this.opts.wsFactory ?? defaultWsFactory;
    this.ws = factory(this.opts.url);

    const d = new Deferred();
    this.connectDeferred = d;

    let helloTimer: NodeJS.Timeout | null = setTimeout(() => {
      helloTimer = null;
      this.cleanup();
      d.settle(() => d.reject(new GatewayError('helloTimeout', 'hello_ok not received within timeout')));
    }, this.opts.helloTimeoutMs ?? 6000);

    const onOpen = () => {
      // If a hello payload is provided, send it on open so the server can
      // register the client as a desktop node (commands / client_id / etc).
      // The same endpoint also accepts no hello → the server will fall back
      // to token-only auth_success without node registration, which is OK
      // for chat but loses agent file-op routing.
      if (this.opts.helloPayload) {
        this.ws!.send(JSON.stringify(this.opts.helloPayload));
      }
    };
    const onMessage = (raw: Buffer) => {
      const parsed = this.parseFrame(raw);
      if (!parsed) {
        const peek = raw.toString('utf-8').slice(0, 200);
        console.warn('[GatewayChannel] unparseable frame:', peek);
        this.recordFrame('<unparseable>');
        return;
      }
      this.recordFrame(parsed.type);
      // Both `hello_ok` (legacy paired-device flow) and `auth_success`
      // (server-proxied flow at ServerConnection.swift:49-55) signal the
      // connection is fully established.
      if (parsed.type === 'hello_ok' || parsed.type === 'auth_success') {
        if (helloTimer) { clearTimeout(helloTimer); helloTimer = null; }
        this.connected = true;
        this.connectDeferred = null;
        this.startKeepalive();
        d.settle(() => d.resolve());
        return;
      }
      if (parsed.type === 'pong') {
        if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null; }
        return;
      }
      if (parsed.type === 'push' && 'topic' in parsed) {
        this.opts.onPush?.(parsed as PushFrame);
        return;
      }
      // Server-proxied envelope: `{type: '<event>', data, request_id?}`.
      // Anything that isn't a connection-lifecycle frame falls here.
      this.opts.onServerMessage?.(parsed as ServerMessageFrame);
    };
    const onClose = (_code: number, reason: Buffer) => {
      if (helloTimer) { clearTimeout(helloTimer); helloTimer = null; }
      const wasConnected = this.connected;
      this.cleanup();
      if (wasConnected) {
        this.opts.onDisconnect?.(reason.toString() || 'closed');
      } else {
        d.settle(() => d.reject(new GatewayError('wsClosed', reason.toString() || 'closed')));
      }
    };
    const onError = (err: Error) => {
      if (helloTimer) { clearTimeout(helloTimer); helloTimer = null; }
      if (this.connected) {
        this.cleanup();
        this.opts.onDisconnect?.(err.message);
      } else {
        this.cleanup();
        d.settle(() => d.reject(new GatewayError('wsError', err.message, err)));
      }
    };

    this.ws.on('open', onOpen as never);
    this.ws.on('message', onMessage as never);
    this.ws.on('close', onClose as never);
    this.ws.on('error', onError as never);

    if (this.ws.readyState === OPEN_STATE) onOpen();

    return d.promise;
  }

  disconnect(): void {
    this.ws?.close();
    this.cleanup();
  }

  private recordFrame(type: string): void {
    this.frameLog.push({ at: Date.now(), type });
    if (this.frameLog.length > FRAME_LOG_MAX) this.frameLog.shift();
  }

  /**
   * Send a JSON-RPC-style request frame to the gateway.
   * Used for outbound notifications like `node.invoke.result`.
   * Synchronous fire-and-forget — no response is awaited at the WS layer.
   *
   * Throws GatewayError('notConnected', ...) when not connected.
   */
  sendRequest(method: string, params: Record<string, unknown>): void {
    if (!this.connected || !this.ws) {
      throw new GatewayError('notConnected', 'cannot sendRequest while disconnected');
    }
    this.ws.send(JSON.stringify({ type: 'request', method, params }));
  }

  /**
   * Send a server-proxied envelope: `{type, request_id?, data?}`. Used by
   * ChatService.sendText to trigger LLM responses on /ws/v1/messages —
   * mirrors macOS ChatService.swift:540-548.
   */
  sendEnvelope(envelope: { type: string; request_id?: string; data?: Record<string, unknown> }): void {
    if (!this.connected || !this.ws) {
      throw new GatewayError('notConnected', 'cannot sendEnvelope while disconnected');
    }
    this.ws.send(JSON.stringify(envelope));
  }

  private startKeepalive(): void {
    // The server-proxied flow (/ws/v1/messages) treats ping as a one-way
    // liveness signal — macOS ServerConnection.swift:120 sends `{type:'ping'}`
    // every 25s and never checks for a pong reply. Our earlier code armed
    // a 30s pong timeout that always fired (server never sends pong),
    // causing a reconnect every ~45s on top of a perfectly healthy WS.
    // Fixed by just sending ping periodically with no response gate.
    // If the WS truly dies, ws.onclose / onerror surface that.
    const interval = this.opts.pingIntervalMs ?? 25000;
    this.pingTimer = setInterval(() => {
      if (!this.connected || !this.ws) return;
      try { this.ws.send(JSON.stringify({ type: 'ping' })); } catch { /* ignore */ }
    }, interval);
  }

  private parseFrame(raw: Buffer | string): import('./gateway-models').GatewayFrame | null {
    try {
      const json = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8'));
      const parsed = GatewayFrameSchema.safeParse(json);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private cleanup(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null; }
    this.connected = false;
    this.ws = null;
    this.connectDeferred = null;
  }
}

function defaultWsFactory(url: string): MinimalWs {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { WebSocket } = require('ws') as typeof import('ws');
  return new WebSocket(url) as unknown as MinimalWs;
}
