import { describe, it, expect, beforeEach } from 'vitest';
import { useGlobalSearchStore } from '../global-search-slice';

describe('useGlobalSearchStore', () => {
  beforeEach(() => useGlobalSearchStore.setState({ isOpen: false }));

  it('open() sets isOpen=true', () => {
    useGlobalSearchStore.getState().open();
    expect(useGlobalSearchStore.getState().isOpen).toBe(true);
  });

  it('close() sets isOpen=false', () => {
    useGlobalSearchStore.setState({ isOpen: true });
    useGlobalSearchStore.getState().close();
    expect(useGlobalSearchStore.getState().isOpen).toBe(false);
  });

  it('toggles via open then close', () => {
    useGlobalSearchStore.getState().open();
    expect(useGlobalSearchStore.getState().isOpen).toBe(true);
    useGlobalSearchStore.getState().close();
    expect(useGlobalSearchStore.getState().isOpen).toBe(false);
  });
});
