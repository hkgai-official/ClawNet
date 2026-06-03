import { create } from 'zustand';

const FLASH_DURATION_MS = 2000;

interface FlashingState {
  currentlyFlashing: string | null;
  /**
   * Mark a message as currently flashing. Auto-clears after
   * FLASH_DURATION_MS. Calling flash() again while a flash is active
   * resets the timer onto the new id.
   */
  flash(messageId: string): void;
}

let activeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Tiny store that powers the "click a search result → jump to that message
 * → highlight it briefly" UX. Decoupled from the search modal + MessageList
 * so either side can read/write without coupling to the other.
 */
export const useFlashingMessageStore = create<FlashingState>((set) => ({
  currentlyFlashing: null,
  flash: (messageId) => {
    if (activeTimer) clearTimeout(activeTimer);
    set({ currentlyFlashing: messageId });
    activeTimer = setTimeout(() => {
      set({ currentlyFlashing: null });
      activeTimer = null;
    }, FLASH_DURATION_MS);
  },
}));
