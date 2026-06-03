import { describe, it, expect } from 'vitest';
import {
  createBuffer, bufferDepth, displayedText, isDrained,
  appendDelta, markComplete, advanceCursor,
  segmentCount,
} from '../stream-buffer';
import type { Participant } from '../../../../../shared/domain/chat';

const sender: Participant = { id: 'a1', name: 'Agent', type: 'agent' };

describe('stream-buffer', () => {
  it('createBuffer initializes empty', () => {
    const b = createBuffer({ conversationId: 'c1', sender });
    expect(bufferDepth(b)).toBe(0);
    expect(displayedText(b)).toBe('');
    expect(b.isComplete).toBe(false);
  });

  it('appendDelta grows receivedContent', () => {
    let b = createBuffer({ conversationId: 'c1', sender });
    b = appendDelta(b, 'hello ');
    b = appendDelta(b, 'world');
    expect(b.receivedContent).toBe('hello world');
    expect(bufferDepth(b)).toBe(11);
  });

  it('advanceCursor returns sliced text up to cursor', () => {
    let b = createBuffer({ conversationId: 'c1', sender });
    b = appendDelta(b, 'hello world');
    b = advanceCursor(b, 5);
    expect(displayedText(b)).toBe('hello');
    expect(bufferDepth(b)).toBe(6);
  });

  it('isDrained when complete and cursor at end', () => {
    let b = createBuffer({ conversationId: 'c1', sender });
    b = appendDelta(b, 'hi');
    expect(isDrained(b)).toBe(false);
    b = markComplete(b);
    expect(isDrained(b)).toBe(false);
    b = advanceCursor(b, 2);
    expect(isDrained(b)).toBe(true);
  });

  it('markComplete with finalText replaces receivedContent and clamps cursor', () => {
    let b = createBuffer({ conversationId: 'c1', sender });
    b = appendDelta(b, 'hi there');
    b = advanceCursor(b, 5);
    b = markComplete(b, 'hi there world');
    expect(b.receivedContent).toBe('hi there world');
    expect(b.displayedCursor).toBeLessThanOrEqual(segmentCount('hi there world'));
  });

  it('segmentCount counts code points (emoji + CJK)', () => {
    expect(segmentCount('hello')).toBe(5);
    expect(segmentCount('你好')).toBe(2);
    expect(segmentCount('a😀b')).toBe(3);
  });

  it('displayedText slices on code-point boundary not UTF-16', () => {
    let b = createBuffer({ conversationId: 'c1', sender });
    b = appendDelta(b, 'a😀b');
    b = advanceCursor(b, 2);
    expect(displayedText(b)).toBe('a😀');
  });
});
