import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PlaybackEngine } from '../playback-engine';
import type { Participant } from '../../../../../shared/domain/chat';

const sender: Participant = { id: 'a1', name: 'Agent', type: 'agent' };

let engine: PlaybackEngine;
let starts: unknown[];
let deltas: unknown[];
let ends: unknown[];
let cancels: unknown[];

beforeEach(() => {
  vi.useFakeTimers();
  starts = []; deltas = []; ends = []; cancels = [];
  engine = new PlaybackEngine({
    onStart: (e) => starts.push(e),
    onDelta: (e) => deltas.push(e),
    onEnd: (e) => ends.push(e),
    onCancelled: (e) => cancels.push(e),
    randomFn: () => 0.5,  // deterministic: randomExtra=6, jitter=0
  });
});
afterEach(() => vi.useRealTimers());

describe('PlaybackEngine lifecycle', () => {
  it('start emits onStart and idles when buffer is empty', () => {
    engine.start('run1', { conversationId: 'c1', sender });
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({ messageId: 'run1', conversationId: 'c1' });
  });

  it('appendDelta + tick emits chunked deltas with full displayedText', async () => {
    engine.start('run1', { conversationId: 'c1', sender });
    engine.appendDelta('run1', 'hello world');
    await vi.advanceTimersByTimeAsync(50);
    expect(deltas.length).toBeGreaterThan(0);
    const d = deltas[0] as { messageId: string; content: string; seq: number };
    expect(d.messageId).toBe('run1');
    expect('hello world'.startsWith(d.content)).toBe(true);
  });

  it('markComplete drains the buffer then emits onEnd with finalText', async () => {
    engine.start('run1', { conversationId: 'c1', sender });
    engine.appendDelta('run1', 'hi');
    engine.markComplete('run1');
    await vi.advanceTimersByTimeAsync(500);
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ messageId: 'run1', finalText: 'hi' });
  });

  it('markComplete with finalText replaces buffer content', async () => {
    engine.start('run1', { conversationId: 'c1', sender });
    engine.appendDelta('run1', 'partial');
    engine.markComplete('run1', 'partial answer fixed');
    await vi.advanceTimersByTimeAsync(2000);
    expect(ends[0]).toMatchObject({ finalText: 'partial answer fixed' });
  });

  it('cancel halts timers and emits onCancelled', async () => {
    engine.start('run1', { conversationId: 'c1', sender });
    engine.appendDelta('run1', 'hello world');
    engine.cancel('run1');
    expect(cancels[0]).toMatchObject({ messageId: 'run1' });
    const deltaCountAfter = deltas.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(deltas.length).toBe(deltaCountAfter);
  });
});

describe('PlaybackEngine chunk size algorithm (spec §7.3)', () => {
  it('chunkSize = baseChunk + randomExtra + catchUp + drainBoost, capped at depth', async () => {
    engine.start('run1', { conversationId: 'c1', sender });
    engine.appendDelta('run1', 'x'.repeat(200));
    // With randomFn=0.5 → randomExtra = floor(0.5*13) = 6
    // depth=200 → catchUp = min(floor(200/50), 30) = 4
    // not complete → drainBoost = 0
    // chunkSize = min(8 + 6 + 4 + 0, 200) = 18
    await vi.advanceTimersByTimeAsync(60);
    const first = deltas[0] as { content: string };
    expect(first.content.length).toBe(18);
  });

  it('drainBoost activates when isComplete', async () => {
    engine.start('run1', { conversationId: 'c1', sender });
    engine.appendDelta('run1', 'x'.repeat(500));
    engine.markComplete('run1');
    // depth=500 → catchUp = min(10, 30) = 10; drainBoost = min(50, 60) = 50
    // chunkSize first tick = min(8+6+10+50, 500) = 74
    await vi.advanceTimersByTimeAsync(60);
    const first = deltas[0] as { content: string };
    expect(first.content.length).toBe(74);
  });
});

describe('PlaybackEngine interval algorithm', () => {
  it('emits subsequent deltas while content remains', async () => {
    engine.start('run1', { conversationId: 'c1', sender });
    engine.appendDelta('run1', 'x'.repeat(100));
    await vi.advanceTimersByTimeAsync(16);
    const before = deltas.length;
    await vi.advanceTimersByTimeAsync(60);
    expect(deltas.length).toBeGreaterThan(before);
  });
});

describe('PlaybackEngine concurrency', () => {
  it('multiple runIds advance independently', async () => {
    engine.start('run1', { conversationId: 'c1', sender });
    engine.start('run2', { conversationId: 'c2', sender });
    engine.appendDelta('run1', 'aaaaaaaa');
    engine.appendDelta('run2', 'bbbbbbbb');
    await vi.advanceTimersByTimeAsync(60);
    const ids = new Set(deltas.map((d) => (d as { messageId: string }).messageId));
    expect(ids.has('run1')).toBe(true);
    expect(ids.has('run2')).toBe(true);
  });
});
