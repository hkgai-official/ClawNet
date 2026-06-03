import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toastStore } from '../toast-overlay';

beforeEach(() => {
  toastStore.setState({ toasts: [] });
});

describe('toastStore', () => {
  it('starts with an empty toasts list', () => {
    expect(toastStore.getState().toasts).toEqual([]);
  });

  it('push adds a toast with a generated id', () => {
    toastStore.getState().push({ message: 'Upload failed', level: 'error' });
    const toasts = toastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.message).toBe('Upload failed');
    expect(toasts[0]?.level).toBe('error');
    expect(toasts[0]?.id).toMatch(/^t-/);
  });

  it('dismiss removes the matching toast', () => {
    toastStore.getState().push({ message: 'A', level: 'info' });
    toastStore.getState().push({ message: 'B', level: 'info' });
    const id = toastStore.getState().toasts[0]!.id;
    toastStore.getState().dismiss(id);
    const remaining = toastStore.getState().toasts;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.message).toBe('B');
  });

  it('toasts auto-dismiss after 3.5s', () => {
    vi.useFakeTimers();
    try {
      toastStore.getState().push({ message: 'x', level: 'info' });
      expect(toastStore.getState().toasts).toHaveLength(1);
      vi.advanceTimersByTime(3500);
      expect(toastStore.getState().toasts).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
