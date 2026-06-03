import type { Participant } from '../../../../shared/domain/chat';

export interface StreamPlaybackBuffer {
  receivedContent: string;
  displayedCursor: number;
  isComplete: boolean;
  conversationId: string;
  sender: Participant;
}

export function createBuffer(init: { conversationId: string; sender: Participant }): StreamPlaybackBuffer {
  return {
    receivedContent: '',
    displayedCursor: 0,
    isComplete: false,
    conversationId: init.conversationId,
    sender: init.sender,
  };
}

export function segmentCount(s: string): number {
  return Array.from(s).length;
}

export function bufferDepth(b: StreamPlaybackBuffer): number {
  return segmentCount(b.receivedContent) - b.displayedCursor;
}

export function displayedText(b: StreamPlaybackBuffer): string {
  return Array.from(b.receivedContent).slice(0, b.displayedCursor).join('');
}

export function isDrained(b: StreamPlaybackBuffer): boolean {
  return b.isComplete && b.displayedCursor >= segmentCount(b.receivedContent);
}

export function appendDelta(b: StreamPlaybackBuffer, delta: string): StreamPlaybackBuffer {
  return { ...b, receivedContent: b.receivedContent + delta };
}

export function markComplete(b: StreamPlaybackBuffer, finalText?: string): StreamPlaybackBuffer {
  if (finalText !== undefined) {
    const finalCount = segmentCount(finalText);
    return {
      ...b,
      receivedContent: finalText,
      displayedCursor: Math.min(b.displayedCursor, finalCount),
      isComplete: true,
    };
  }
  return { ...b, isComplete: true };
}

export function advanceCursor(b: StreamPlaybackBuffer, by: number): StreamPlaybackBuffer {
  return { ...b, displayedCursor: b.displayedCursor + by };
}
