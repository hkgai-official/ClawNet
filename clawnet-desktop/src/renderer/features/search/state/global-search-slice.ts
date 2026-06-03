import { create } from 'zustand';

interface GlobalSearchState {
  isOpen: boolean;
  open(): void;
  close(): void;
}

/**
 * Single boolean — controls whether the global search modal is mounted.
 * Query text lives in component state inside the modal itself, since it
 * resets on every open and doesn't need to be shared elsewhere.
 */
export const useGlobalSearchStore = create<GlobalSearchState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
