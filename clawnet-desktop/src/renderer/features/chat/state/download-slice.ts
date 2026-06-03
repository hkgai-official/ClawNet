import { create } from 'zustand';

export type DownloadStatus = 'in_progress' | 'completed' | 'failed';

export interface DownloadEntry {
  bytesReceived: number;
  /** Backfilled by the first `chat.download.progress` event whose payload
   *  carries the real Content-Length (the `started` event fires before
   *  headers arrive, so it lands as 0). Determinate fill only once > 0. */
  totalBytes: number;
  status: DownloadStatus;
  localPath?: string;
  reason?: string;
}

/**
 * Per-message download progress slice. Keyed by the real (server-confirmed)
 * messageId. Renderer-side mirror of `chat.download.*` events emitted from
 * main during a `chat.fetchFileForOpen` invocation. Symmetric counterpart to
 * `upload-slice` (which is keyed by tempId).
 */
export interface DownloadState {
  downloads: Record<string, DownloadEntry>;
  startDownload(messageId: string, totalBytes: number): void;
  /** `totalBytes` is optional: passes through and overwrites the cached
   *  value when present so the response Content-Length can land via the
   *  first progress event. */
  updateProgress(messageId: string, bytesReceived: number, totalBytes?: number): void;
  completeDownload(messageId: string, localPath: string): void;
  failDownload(messageId: string, reason: string): void;
}

export const useDownloadStore = create<DownloadState>((set) => ({
  downloads: {},
  startDownload: (messageId, totalBytes) =>
    set((s) => ({
      downloads: {
        ...s.downloads,
        [messageId]: { bytesReceived: 0, totalBytes, status: 'in_progress' },
      },
    })),
  updateProgress: (messageId, bytesReceived, totalBytes) =>
    set((s) => {
      const cur = s.downloads[messageId];
      if (!cur) return s;
      const next = { ...cur, bytesReceived };
      if (totalBytes !== undefined) next.totalBytes = totalBytes;
      return { downloads: { ...s.downloads, [messageId]: next } };
    }),
  completeDownload: (messageId, localPath) =>
    set((s) => ({
      downloads: s.downloads[messageId]
        ? {
            ...s.downloads,
            [messageId]: { ...s.downloads[messageId]!, status: 'completed', localPath },
          }
        : {
            ...s.downloads,
            [messageId]: { bytesReceived: 0, totalBytes: 0, status: 'completed', localPath },
          },
    })),
  failDownload: (messageId, reason) =>
    set((s) => ({
      downloads: s.downloads[messageId]
        ? {
            ...s.downloads,
            [messageId]: { ...s.downloads[messageId]!, status: 'failed', reason },
          }
        : s.downloads,
    })),
}));
