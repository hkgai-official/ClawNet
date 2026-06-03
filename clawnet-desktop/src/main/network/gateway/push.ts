import type { PushFrame, ServerMessageFrame } from './gateway-models';

type Listener = (payload: unknown) => void;

/**
 * Dispatches server-pushed events to subscribers keyed by event type.
 *
 * Two frame shapes are supported:
 *  - Legacy paired-device flow: `{type: 'push', topic, payload}` (see
 *    PushFrame). Routed by `topic`, payload handed to listener.
 *  - Server-proxied flow (/ws/v1/messages): `{type: 'message.new', data, ...}`
 *    (see ServerMessageFrame). Routed by `type`, `data` handed to listener.
 *
 * Subscribers don't care which shape produced the event — they register
 * a string key that matches either `frame.topic` or `frame.type`.
 *
 * Wildcards: a subscription ending in `.*` matches any nested suffix.
 *  e.g. `subscribe('message.*', cb)` fires for `message.new`, `message.sent`,
 *  `message.stream_delta`, etc.
 */
/** One entry in the diagnostic ring buffer. Kept tiny so we can hold
 *  ~50 in memory without blowing main-process RSS. */
export interface PushDiagEntry {
  at: number;            // Date.now()
  key: string;           // topic (paired-device) or type (server-proxied)
  matched: number;       // how many subscribers fired
  preview: string;       // JSON.stringify(payload).slice(0,400)
}

const DIAG_BUFFER_MAX = 50;

export class PushDispatcher {
  private exact = new Map<string, Set<Listener>>();
  private prefix = new Map<string, Set<Listener>>();
  // Diagnostic ring buffer — surfaces "what did the server actually push"
  // via `__diag.recentPushes` IPC. Useful for triaging "expected card
  // didn't render" bugs against a production server.
  private diagBuffer: PushDiagEntry[] = [];

  subscribe(topic: string, listener: Listener): () => void {
    const map = topic.endsWith('.*') ? this.prefix : this.exact;
    const key = topic.endsWith('.*') ? topic.slice(0, -2) : topic;
    let set = map.get(key);
    if (!set) { set = new Set(); map.set(key, set); }
    set.add(listener);
    return () => { set!.delete(listener); };
  }

  /** Paired-device flow: route by `topic`, hand listener `payload`. */
  dispatch(frame: PushFrame): void {
    this.fire(frame.topic, frame.payload);
  }

  /** Server-proxied flow: route by `type`, hand listener `data`. */
  dispatchServerMessage(frame: ServerMessageFrame): void {
    this.fire(frame.type, frame.data);
  }

  /** Read-only view of the last ~50 dispatched frames. */
  getDiagBuffer(): ReadonlyArray<PushDiagEntry> {
    return this.diagBuffer;
  }

  private fire(key: string, payload: unknown): void {
    let matched = 0;
    const exact = this.exact.get(key);
    if (exact) { for (const cb of exact) cb(payload); matched += exact.size; }
    for (const [prefix, set] of this.prefix) {
      if (key === prefix || key.startsWith(prefix + '.')) {
        for (const cb of set) cb(payload);
        matched += set.size;
      }
    }
    // Push diagnostic record. Truncate preview aggressively — full
    // payloads can be tens of KB (stream deltas), so 400 chars is plenty
    // to identify the frame.
    let preview: string;
    try { preview = JSON.stringify(payload).slice(0, 400); }
    catch { preview = '[unserializable]'; }
    this.diagBuffer.push({ at: Date.now(), key, matched, preview });
    if (this.diagBuffer.length > DIAG_BUFFER_MAX) this.diagBuffer.shift();
  }
}
