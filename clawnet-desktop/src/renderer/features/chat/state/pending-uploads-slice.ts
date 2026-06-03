import { create } from 'zustand';

/**
 * A file the user has staged in the composer but not yet sent. Each item
 * carries enough metadata for a chip + thumbnail render and for the
 * eventual upload call. Native file-picker / drag-drop produce `path`
 * items; clipboard paste produces `bytes` items.
 */
export type PendingUpload =
  | {
      id: string;
      kind: 'path';
      name: string;
      path: string;
      mimeType?: string;
      sizeBytes?: number;
    }
  | {
      id: string;
      kind: 'bytes';
      name: string;
      bytes: Uint8Array;
      mimeType?: string;
      /** Browser blob URL for thumbnail preview; revoked on remove. */
      previewURL?: string;
    };

interface PendingUploadsState {
  /** Per-conversation queue keyed by conversationId. */
  byConversation: Record<string, PendingUpload[]>;
  add(conversationId: string, item: PendingUpload): void;
  remove(conversationId: string, id: string): void;
  clear(conversationId: string): void;
}

export const usePendingUploadsStore = create<PendingUploadsState>((set) => ({
  byConversation: {},
  add: (conversationId, item) =>
    set((s) => ({
      byConversation: {
        ...s.byConversation,
        [conversationId]: [...(s.byConversation[conversationId] ?? []), item],
      },
    })),
  remove: (conversationId, id) =>
    set((s) => {
      const cur = s.byConversation[conversationId] ?? [];
      const item = cur.find((x) => x.id === id);
      if (item?.kind === 'bytes' && item.previewURL) {
        URL.revokeObjectURL(item.previewURL);
      }
      return {
        byConversation: {
          ...s.byConversation,
          [conversationId]: cur.filter((x) => x.id !== id),
        },
      };
    }),
  clear: (conversationId) =>
    set((s) => {
      const cur = s.byConversation[conversationId] ?? [];
      for (const item of cur) {
        if (item.kind === 'bytes' && item.previewURL) {
          URL.revokeObjectURL(item.previewURL);
        }
      }
      const next = { ...s.byConversation };
      delete next[conversationId];
      return { byConversation: next };
    }),
}));

/** Convenience helper to read the pending list for a given conversation. */
export function getPending(conversationId: string): PendingUpload[] {
  return usePendingUploadsStore.getState().byConversation[conversationId] ?? [];
}
