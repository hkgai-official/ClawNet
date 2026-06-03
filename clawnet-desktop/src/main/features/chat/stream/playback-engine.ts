import type { Participant } from '../../../../shared/domain/chat';
import {
  type StreamPlaybackBuffer,
  createBuffer, bufferDepth,
  appendDelta, markComplete, advanceCursor,
} from './stream-buffer';

export interface StreamStartEvent {
  messageId: string;
  conversationId: string;
  sender: Participant;
}

export interface StreamDeltaEvent {
  messageId: string;
  content: string;
  seq: number;
}

export interface StreamEndEvent {
  messageId: string;
  conversationId: string;
  sender: Participant;
  finalText: string;
}

export interface StreamCancelledEvent {
  messageId: string;
}

export interface PlaybackEngineOptions {
  onStart: (e: StreamStartEvent) => void;
  onDelta: (e: StreamDeltaEvent) => void;
  onEnd: (e: StreamEndEvent) => void;
  onCancelled: (e: StreamCancelledEvent) => void;
  randomFn?: () => number;
}

const INITIAL_TICK_MS = 16;
const MIN_INTERVAL_MS = 8;
const MAX_BUFFER_BYTES = 256 * 1024;

export class PlaybackEngine {
  private buffers = new Map<string, StreamPlaybackBuffer>();
  private timers = new Map<string, NodeJS.Timeout>();
  private segCache = new Map<string, string[]>();
  private readonly random: () => number;

  constructor(private readonly opts: PlaybackEngineOptions) {
    this.random = opts.randomFn ?? Math.random;
  }

  start(runId: string, init: { conversationId: string; sender: Participant }): void {
    if (this.buffers.has(runId)) return;
    this.buffers.set(runId, createBuffer(init));
    this.opts.onStart({ messageId: runId, conversationId: init.conversationId, sender: init.sender });
    this.scheduleTick(runId, INITIAL_TICK_MS);
  }

  appendDelta(runId: string, delta: string): void {
    const b = this.buffers.get(runId);
    if (!b) return;
    if (b.receivedContent.length + delta.length > MAX_BUFFER_BYTES) return;
    this.buffers.set(runId, appendDelta(b, delta));
    this.segCache.delete(runId);
  }

  markComplete(runId: string, finalText?: string): void {
    const b = this.buffers.get(runId);
    if (!b) return;
    this.buffers.set(runId, markComplete(b, finalText));
    this.segCache.delete(runId);
  }

  cancel(runId: string): void {
    const t = this.timers.get(runId);
    if (t) clearTimeout(t);
    this.timers.delete(runId);
    this.buffers.delete(runId);
    this.segCache.delete(runId);
    this.opts.onCancelled({ messageId: runId });
  }

  shutdown(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.buffers.clear();
    this.segCache.clear();
  }

  private tick(runId: string): void {
    const b = this.buffers.get(runId);
    if (!b) return;
    const depth = bufferDepth(b);

    if (depth === 0) {
      if (b.isComplete) { this.finalize(runId); return; }
      this.scheduleTick(runId, INITIAL_TICK_MS);
      return;
    }

    const baseChunk = 8;
    const randomExtra = Math.floor(this.random() * 13);
    const catchUp = Math.min(Math.floor(depth / 50), 30);
    const drainBoost = b.isComplete ? Math.min(Math.floor(depth / 10), 60) : 0;
    const chunkSize = Math.min(baseChunk + randomExtra + catchUp + drainBoost, depth);

    const next = advanceCursor(b, chunkSize);
    this.buffers.set(runId, next);

    const text = this.displayedTextCached(runId, next);
    this.opts.onDelta({
      messageId: runId,
      content: text,
      seq: next.displayedCursor,
    });

    const len = next.displayedCursor;
    const baseInterval = len > 5000 ? 200 : len > 2000 ? 100 : 50;
    const jitter = (this.random() * 24) - 12;
    const speedUp = Math.min(depth * 0.08, 15);
    const drainSpeedUp = next.isComplete ? 10 : 0;
    const interval = Math.max(baseInterval + jitter - speedUp - drainSpeedUp, MIN_INTERVAL_MS);

    this.scheduleTick(runId, interval);
  }

  private scheduleTick(runId: string, ms: number): void {
    const prev = this.timers.get(runId);
    if (prev) clearTimeout(prev);
    this.timers.set(runId, setTimeout(() => this.tick(runId), ms));
  }

  private finalize(runId: string): void {
    const b = this.buffers.get(runId);
    if (!b) return;
    this.opts.onEnd({
      messageId: runId,
      conversationId: b.conversationId,
      sender: b.sender,
      finalText: b.receivedContent,
    });
    const t = this.timers.get(runId);
    if (t) clearTimeout(t);
    this.timers.delete(runId);
    this.buffers.delete(runId);
    this.segCache.delete(runId);
  }

  private displayedTextCached(runId: string, b: StreamPlaybackBuffer): string {
    let segs = this.segCache.get(runId);
    if (!segs) {
      segs = Array.from(b.receivedContent);
      this.segCache.set(runId, segs);
    }
    return segs.slice(0, b.displayedCursor).join('');
  }
}

export { segmentCount } from './stream-buffer';
