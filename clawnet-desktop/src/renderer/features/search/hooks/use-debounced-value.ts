import { useEffect, useState } from 'react';

/**
 * Returns a debounced copy of `value` that only updates after `delayMs`
 * has passed without further changes. Used by the global-search modal to
 * avoid firing IPC calls on every keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
