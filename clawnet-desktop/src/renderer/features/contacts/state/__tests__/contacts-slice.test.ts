import { describe, it, expect, beforeEach } from 'vitest';
import { useContactsStore } from '../contacts-slice';

describe('useContactsStore', () => {
  beforeEach(() => useContactsStore.setState({ selectedContactId: null, addContactModalOpen: false }));

  it('setSelectedContactId', () => {
    useContactsStore.getState().setSelectedContactId('c1');
    expect(useContactsStore.getState().selectedContactId).toBe('c1');
  });

  it('toggles addContactModal open/closed', () => {
    useContactsStore.getState().openAddContactModal();
    expect(useContactsStore.getState().addContactModalOpen).toBe(true);
    useContactsStore.getState().closeAddContactModal();
    expect(useContactsStore.getState().addContactModalOpen).toBe(false);
  });
});
