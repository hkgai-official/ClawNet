import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFlashingMessageStore } from '../flashing-message-slice';

describe('useFlashingMessageStore', () => {
  beforeEach(() => useFlashingMessageStore.setState({ currentlyFlashing: null }));

  it('flash(id) sets currentlyFlashing immediately', () => {
    useFlashingMessageStore.getState().flash('m-1');
    expect(useFlashingMessageStore.getState().currentlyFlashing).toBe('m-1');
  });

  it('flash auto-clears after 2 seconds', () => {
    vi.useFakeTimers();
    useFlashingMessageStore.getState().flash('m-1');
    expect(useFlashingMessageStore.getState().currentlyFlashing).toBe('m-1');
    vi.advanceTimersByTime(2001);
    expect(useFlashingMessageStore.getState().currentlyFlashing).toBeNull();
    vi.useRealTimers();
  });

  it('flash with a new id while one is flashing replaces the previous', () => {
    vi.useFakeTimers();
    useFlashingMessageStore.getState().flash('m-1');
    vi.advanceTimersByTime(1000);
    useFlashingMessageStore.getState().flash('m-2');
    vi.advanceTimersByTime(1500);
    // 2.5s from start of m-1 = past 2s, but flash('m-2') reset the timer
    // 1.5s after m-2's flash → still within m-2's 2s window
    expect(useFlashingMessageStore.getState().currentlyFlashing).toBe('m-2');
    vi.advanceTimersByTime(600);
    expect(useFlashingMessageStore.getState().currentlyFlashing).toBeNull();
    vi.useRealTimers();
  });
});
