import { useMutation } from '@tanstack/react-query';
import { useIpc } from '../../../hooks/use-ipc';
import { useIpcEvent } from '../../../hooks/use-ipc-event';
import { useDownloadStore } from '../state/download-slice';

/**
 * Registers the four `chat.download.*` IPC subscribers ONCE at a parent
 * level (chat-container). Each subscriber mirrors the corresponding event
 * into the global download-slice. Without lifting this up, every mounted
 * `FileMessageBubble` would register its own copy, scaling listeners as
 * `4 × N` for N file messages on screen.
 *
 * The download slot is keyed by the real server-confirmed `messageId`, so
 * a single global subscriber suffices — bubbles read the slice for their
 * own state.
 */
export function useDownloadEventsSubscriber(): void {
  const start = useDownloadStore((s) => s.startDownload);
  const update = useDownloadStore((s) => s.updateProgress);
  const complete = useDownloadStore((s) => s.completeDownload);
  const fail = useDownloadStore((s) => s.failDownload);

  useIpcEvent('chat.download.started', ({ messageId, totalBytes }) =>
    start(messageId, totalBytes),
  );
  useIpcEvent('chat.download.progress', ({ messageId, bytesReceived, totalBytes }) =>
    update(messageId, bytesReceived, totalBytes),
  );
  useIpcEvent('chat.download.completed', ({ messageId, localPath }) =>
    complete(messageId, localPath),
  );
  useIpcEvent('chat.download.failed', ({ messageId, reason }) =>
    fail(messageId, reason),
  );
}

/**
 * Per-bubble mutation around `chat.fetchFileForOpen`. Pure mutation, no
 * subscription side effects — the four `chat.download.*` events are
 * subscribed once at `useDownloadEventsSubscriber` instead. Bubbles read
 * progress from the global download-slice, keyed by messageId.
 */
export function useFileDownloadMutation() {
  const ipc = useIpc();
  return useMutation({
    mutationFn: async ({ messageId, fileId }: { messageId: string; fileId: string }) => {
      return ipc('chat.fetchFileForOpen', { messageId, fileId });
    },
  });
}
