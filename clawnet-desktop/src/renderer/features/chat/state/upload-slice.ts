import { create } from 'zustand';

export type UploadStatus = 'in_progress' | 'failed';

export interface UploadEntry {
  bytesSent: number;
  totalBytes: number;
  status: UploadStatus;
  reason?: string;
}

/**
 * Per-temp-id upload progress slice. Keyed by the temp message id assigned
 * by `ConversationStore.addOptimisticMessage`. Renderer-side mirror of the
 * upload events emitted from main during a `chat.sendFile` invocation:
 *  - `chat.upload.progress` → updateProgress
 *  - `chat.upload.failed`   → failUpload
 * Completion clears the slot (the real message arrives via
 * `chat.message.created`).
 */
export interface UploadState {
  uploads: Record<string, UploadEntry>;
  startUpload(tempId: string, totalBytes: number): void;
  updateProgress(tempId: string, bytesSent: number): void;
  completeUpload(tempId: string): void;
  failUpload(tempId: string, reason: string): void;
  setTotalBytes(tempId: string, totalBytes: number): void;
}

export const useUploadStore = create<UploadState>((set) => ({
  uploads: {},
  startUpload: (tempId, totalBytes) =>
    set((s) => ({
      uploads: {
        ...s.uploads,
        [tempId]: { bytesSent: 0, totalBytes, status: 'in_progress' },
      },
    })),
  updateProgress: (tempId, bytesSent) =>
    set((s) => {
      const cur = s.uploads[tempId];
      if (!cur) return s;
      return { uploads: { ...s.uploads, [tempId]: { ...cur, bytesSent } } };
    }),
  completeUpload: (tempId) =>
    set((s) => {
      if (!(tempId in s.uploads)) return s;
      const next = { ...s.uploads };
      delete next[tempId];
      return { uploads: next };
    }),
  failUpload: (tempId, reason) =>
    set((s) => {
      const cur = s.uploads[tempId];
      if (!cur) return s;
      return { uploads: { ...s.uploads, [tempId]: { ...cur, status: 'failed', reason } } };
    }),
  setTotalBytes: (tempId, totalBytes) =>
    set((s) => ({
      uploads: s.uploads[tempId]
        ? { ...s.uploads, [tempId]: { ...s.uploads[tempId]!, totalBytes } }
        : s.uploads,
    })),
}));
