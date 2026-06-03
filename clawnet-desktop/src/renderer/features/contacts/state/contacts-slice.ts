import { create } from 'zustand';

interface ContactsState {
  selectedContactId: string | null;
  addContactModalOpen: boolean;
  setSelectedContactId(id: string | null): void;
  openAddContactModal(): void;
  closeAddContactModal(): void;
}

/**
 * Client-only state for the contacts panel: which contact is selected (for
 * the detail view) and whether the Add-friend modal is open. Contacts +
 * friend-requests data live in TanStack Query cache.
 */
export const useContactsStore = create<ContactsState>((set) => ({
  selectedContactId: null,
  addContactModalOpen: false,
  setSelectedContactId: (id) => set({ selectedContactId: id }),
  openAddContactModal: () => set({ addContactModalOpen: true }),
  closeAddContactModal: () => set({ addContactModalOpen: false }),
}));
