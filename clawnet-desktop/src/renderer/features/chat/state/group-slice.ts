import { create } from 'zustand';

/**
 * UI state for the P2D group conversation panels.
 *
 * Owns three independent flags:
 *   - `newGroupModalOpen` — the "New group" modal in the conversations sidebar
 *   - `inviteModalForConversationId` — when non-null, an Invite-Members modal
 *     is showing for that specific conversation (drives both the modal's
 *     visibility and which conversation it operates against)
 *   - `groupDetailOpen` — right-side detail panel for the currently-active
 *     group conversation. Resolved against `useChatStore.activeConversationId`
 *     inside `GroupDetailPanel`; this flag only controls visibility.
 */
interface GroupState {
  /** New direct conversation picker (macOS NewChatSheet equivalent). */
  newChatModalOpen: boolean;
  newGroupModalOpen: boolean;
  /** A2A dialog initiator wizard (macOS AgentDialogWizard equivalent). */
  agentDialogWizardOpen: boolean;
  inviteModalForConversationId: string | null;
  groupDetailOpen: boolean;
  openNewChatModal(): void;
  closeNewChatModal(): void;
  openNewGroupModal(): void;
  closeNewGroupModal(): void;
  openAgentDialogWizard(): void;
  closeAgentDialogWizard(): void;
  openInviteModal(conversationId: string): void;
  closeInviteModal(): void;
  setGroupDetailOpen(open: boolean): void;
}

export const useGroupStore = create<GroupState>((set) => ({
  newChatModalOpen: false,
  newGroupModalOpen: false,
  agentDialogWizardOpen: false,
  inviteModalForConversationId: null,
  groupDetailOpen: false,
  openNewChatModal: () => set({ newChatModalOpen: true }),
  closeNewChatModal: () => set({ newChatModalOpen: false }),
  openNewGroupModal: () => set({ newGroupModalOpen: true }),
  closeNewGroupModal: () => set({ newGroupModalOpen: false }),
  openAgentDialogWizard: () => set({ agentDialogWizardOpen: true }),
  closeAgentDialogWizard: () => set({ agentDialogWizardOpen: false }),
  openInviteModal: (id) => set({ inviteModalForConversationId: id }),
  closeInviteModal: () => set({ inviteModalForConversationId: null }),
  setGroupDetailOpen: (open) => set({ groupDetailOpen: open }),
}));
