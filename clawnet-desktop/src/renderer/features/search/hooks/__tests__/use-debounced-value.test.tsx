// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedValue } from '../use-debounced-value';

describe('useDebouncedValue', () => {
  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('hello', 300));
    expect(result.current).toBe('hello');
  });

  it('updates after the delay elapses', async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), {
      initialProps: { v: 'a' },
    });
    rerender({ v: 'b' });
    expect(result.current).toBe('a');
    await act(async () => { vi.advanceTimersByTime(299); });
    expect(result.current).toBe('a');
    await act(async () => { vi.advanceTimersByTime(2); });
    expect(result.current).toBe('b');
    vi.useRealTimers();
  });

  it('cancels the pending timer when the value changes again quickly', async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), {
      initialProps: { v: 'a' },
    });
    rerender({ v: 'b' });
    await act(async () => { vi.advanceTimersByTime(150); });
    rerender({ v: 'c' });
    await act(async () => { vi.advanceTimersByTime(299); });
    expect(result.current).toBe('a');
    await act(async () => { vi.advanceTimersByTime(2); });
    expect(result.current).toBe('c');
    vi.useRealTimers();
  });
});
