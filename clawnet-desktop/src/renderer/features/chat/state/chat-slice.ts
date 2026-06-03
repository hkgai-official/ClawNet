import { create } from 'zustand';

interface ChatStore {
  activeConversationId: string | null;
  setActiveConversation: (id: string | null) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  activeConversationId: null,
  setActiveConversation: (id) => set({ activeConversationId: id }),
}));
