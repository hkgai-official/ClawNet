// @vitest-environment jsdom
// src/renderer/features/chat/state/__tests__/use-is-streaming.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStreamingStore } from '../streaming-slice';
import { useIsStreaming } from '../../hooks/use-is-streaming';

beforeEach(() => {
  useStreamingStore.setState({ byId: {} });
});

describe('useIsStreaming', () => {
  it('returns false when no streams are active', () => {
    const { result } = renderHook(() => useIsStreaming());
    expect(result.current).toBe(false);
  });

  it('returns true while at least one stream is active', () => {
    useStreamingStore.getState().applyStart({
      messageId: 'm1',
      conversationId: 'c1',
      sender: { id: 'u1', name: 'X', type: 'human' },
    });
    const { result } = renderHook(() => useIsStreaming());
    expect(result.current).toBe(true);
  });

  it('flips back to false when all streams end', () => {
    useStreamingStore.getState().applyStart({
      messageId: 'm1',
      conversationId: 'c1',
      sender: { id: 'u1', name: 'X', type: 'human' },
    });
    const { result, rerender } = renderHook(() => useIsStreaming());
    expect(result.current).toBe(true);

    useStreamingStore.getState().applyEnd({ messageId: 'm1' });
    rerender();
    expect(result.current).toBe(false);
  });
});
