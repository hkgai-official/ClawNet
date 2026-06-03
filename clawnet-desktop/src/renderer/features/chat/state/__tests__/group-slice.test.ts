import { describe, it, expect, beforeEach } from 'vitest';
import { useGroupStore } from '../group-slice';

describe('useGroupStore', () => {
  beforeEach(() => useGroupStore.setState({
    newGroupModalOpen: false,
    inviteModalForConversationId: null,
    groupDetailOpen: false,
  }));

  it('opens / closes the new-group modal', () => {
    useGroupStore.getState().openNewGroupModal();
    expect(useGroupStore.getState().newGroupModalOpen).toBe(true);
    useGroupStore.getState().closeNewGroupModal();
    expect(useGroupStore.getState().newGroupModalOpen).toBe(false);
  });

  it('opens the invite modal keyed by conversationId', () => {
    useGroupStore.getState().openInviteModal('c-grp');
    expect(useGroupStore.getState().inviteModalForConversationId).toBe('c-grp');
    useGroupStore.getState().closeInviteModal();
    expect(useGroupStore.getState().inviteModalForConversationId).toBeNull();
  });

  it('toggles group detail panel', () => {
    useGroupStore.getState().setGroupDetailOpen(true);
    expect(useGroupStore.getState().groupDetailOpen).toBe(true);
    useGroupStore.getState().setGroupDetailOpen(false);
    expect(useGroupStore.getState().groupDetailOpen).toBe(false);
  });
});
