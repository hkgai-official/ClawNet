import { create } from 'zustand';
import type { Participant } from '../../../../shared/domain/chat';

interface StreamingEntry {
  messageId: string;
  conversationId: string;
  sender: Participant;
  content: string;
  seq: number;
}

interface StreamingStore {
  byId: Record<string, StreamingEntry>;
  applyStart: (e: { messageId: string; conversationId: string; sender: Participant }) => void;
  applyDelta: (e: { messageId: string; content: string; seq: number }) => void;
  applyEnd: (e: { messageId: string }) => void;
  applyCancelled: (e: { messageId: string }) => void;
}

export const useStreamingStore = create<StreamingStore>((set) => ({
  byId: {},
  applyStart: (e) => set((state) => ({
    byId: { ...state.byId, [e.messageId]: { ...e, content: '', seq: 0 } },
  })),
  applyDelta: (e) => set((state) => {
    const cur = state.byId[e.messageId];
    if (!cur) return state;
    if (cur.seq >= e.seq) return state;
    return { byId: { ...state.byId, [e.messageId]: { ...cur, content: e.content, seq: e.seq } } };
  }),
  applyEnd: (e) => set((state) => {
    const next = { ...state.byId };
    delete next[e.messageId];
    return { byId: next };
  }),
  applyCancelled: (e) => set((state) => {
    const next = { ...state.byId };
    delete next[e.messageId];
    return { byId: next };
  }),
}));
