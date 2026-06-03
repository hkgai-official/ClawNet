import { useMutation } from '@tanstack/react-query';
import { useIpc } from '../../../hooks/use-ipc';
import { useIpcEvent } from '../../../hooks/use-ipc-event';
import { useUploadStore } from '../state/upload-slice';

/**
 * React-Query mutation that triggers a `chat.sendFile` IPC and reflects the
 * main-process upload progress/failure events into the local upload slice.
 *
 * Note: total bytes are not currently known until main reads the file; the
 * UI shows an indeterminate spinner from the moment the user attaches a
 * file. We swap that for a real progress bar in a future perf phase when
 * main starts emitting `chat.upload.progress` events (the event is wired
 * here so renderer state stays correct as soon as main starts emitting).
 */
/** Renderer-side upload input. Either a native filesystem path (file-picker
 *  / drag-drop of native files) OR an in-memory blob (clipboard paste). */
export type UploadInput =
  | string
  | { bytes: Uint8Array; name: string; mimeType?: string };

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  // Chunked to avoid blowing the call stack on large images.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

export function useFileUpload(conversationId: string) {
  const ipc = useIpc();
  const updateProgress = useUploadStore((s) => s.updateProgress);
  const failUpload = useUploadStore((s) => s.failUpload);
  const completeUpload = useUploadStore((s) => s.completeUpload);

  useIpcEvent('chat.upload.progress', ({ tempId, bytesSent, totalBytes }) => {
    // Backfill totalBytes when composer didn't know the size on send (path branch starts with 0).
    const entry = useUploadStore.getState().uploads[tempId];
    if (entry && entry.totalBytes !== totalBytes) {
      useUploadStore.getState().setTotalBytes(tempId, totalBytes);
    }
    updateProgress(tempId, bytesSent);
  });
  useIpcEvent('chat.upload.failed', ({ tempId, reason }) => failUpload(tempId, reason));

  return useMutation({
    mutationFn: async ({ tempId, input }: { tempId: string; input: UploadInput }) => {
      const result =
        typeof input === 'string'
          ? await ipc('chat.sendFile', { conversationId, localPath: input, tempId })
          : await ipc('chat.sendFileBytes', {
              conversationId,
              bytesBase64: bytesToBase64(input.bytes),
              name: input.name,
              ...(input.mimeType ? { mimeType: input.mimeType } : {}),
              tempId,
            });
      // The main process emits `chat.message.created` after the REST POST
      // resolves, so useMessages picks up the new bubble via its IPC event
      // listener — no manual cache update needed.
      completeUpload(result.id);
      return result;
    },
  });
}
