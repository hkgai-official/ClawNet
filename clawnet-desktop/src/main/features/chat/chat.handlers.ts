import { app } from 'electron';
import { writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Requests } from '../../../shared/ipc-contract';
import type { IpcRouter } from '../../core/ipc-router';
import type { ChatService } from './chat.service';
import type { FileService } from '../../network/file-service';
import type { ConversationStoreLike } from '../../store/conversation-store';
import type { PlaybackEngine } from './stream/playback-engine';
import { showOpenFileDialog, showSaveDialog } from '../../dialogs';
import { AppPaths } from '../../core/paths';

export interface ChatHandlerDeps {
  /** Show a native Save-As dialog. Returns destination path or null when
   *  cancelled. Injected so unit tests can stub electron. */
  showSaveDialog: (opts: { suggestedName: string }) => Promise<string | null>;
  /** Show a native Open-File dialog. Returns chosen path or null. */
  showOpenFileDialog: () => Promise<string | null>;
  /** Fallback destination dir when user cancels Save-As. */
  defaultDownloadsDir: () => string;
  /** Stream playback engine — used by chat.stream.cancel to stop local
   *  typing animation immediately, in addition to sending message.stop
   *  via the gateway. */
  playbackEngine: PlaybackEngine;
  /** Resolve the destination dir for `chat.fetchFileForOpen` cached files.
   *  Defaults to `AppPaths.mediaCache()` in production; overridable for tests. */
  mediaCacheDir: () => string;
  /** Store lookup so `chat.fetchFileForOpen` can resolve the safe filename
   *  from the message record. */
  store: ConversationStoreLike;
  /** Per-message download lifecycle event emitters wired to the IPC event
   *  bus — kept as deps (rather than reaching for a module-level singleton)
   *  so tests can pass spies and assert the order. */
  emitDownloadStarted: (e: { messageId: string; totalBytes: number }) => void;
  emitDownloadProgress: (e: { messageId: string; bytesReceived: number; totalBytes: number }) => void;
  emitDownloadCompleted: (e: { messageId: string; localPath: string }) => void;
  emitDownloadFailed: (e: { messageId: string; reason: string }) => void;
}

function safeFileName(raw: string): string {
  return raw.replace(/[/\\?%*:|"<>]/g, '_').replace(/^\.+/, '_') || 'file';
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export function registerChatHandlers(
  router: IpcRouter,
  svc: ChatService,
  files: FileService,
  deps: ChatHandlerDeps,
): void {
  router.register('chat.conversations.list', {
    input: Requests['chat.conversations.list'].input,
    output: Requests['chat.conversations.list'].output,
    handler: async () => svc.listConversations(),
  });
  router.register('chat.conversations.get', {
    input: Requests['chat.conversations.get'].input,
    output: Requests['chat.conversations.get'].output,
    handler: async ({ id }) => svc.getConversation(id),
  });
  router.register('chat.conversations.markRead', {
    input: Requests['chat.conversations.markRead'].input,
    output: Requests['chat.conversations.markRead'].output,
    handler: async ({ id, lastReadMessageId }) => svc.markRead(id, lastReadMessageId),
  });
  router.register('chat.conversations.delete', {
    input: Requests['chat.conversations.delete'].input,
    output: Requests['chat.conversations.delete'].output,
    handler: async ({ id }) => svc.deleteConversation(id),
  });
  router.register('chat.stream.cancel', {
    input: Requests['chat.stream.cancel'].input,
    output: Requests['chat.stream.cancel'].output,
    handler: async ({ messageId, conversationId }) => {
      // Drop local buffer first so typing stops immediately, then signal
      // the server. Order matters for perceived responsiveness — even if
      // the WS hop is slow, the bubble freezes the moment the user clicks.
      // Local buffer is keyed by messageId; server envelope is keyed by
      // conversationId (matches macOS abortCurrentRun).
      deps.playbackEngine.cancel(messageId);
      svc.cancelStream(conversationId);
    },
  });
  router.register('chat.messages.list', {
    input: Requests['chat.messages.list'].input,
    output: Requests['chat.messages.list'].output,
    handler: async ({ conversationId, page, pageSize }) =>
      svc.listMessages(conversationId, page, pageSize),
  });
  router.register('chat.messages.sendText', {
    input: Requests['chat.messages.sendText'].input,
    output: Requests['chat.messages.sendText'].output,
    handler: async ({ conversationId, text }) => svc.sendText(conversationId, text),
  });
  router.register('chat.messages.delete', {
    input: Requests['chat.messages.delete'].input,
    output: Requests['chat.messages.delete'].output,
    handler: async ({ id, conversationId }) => svc.deleteMessage(conversationId, id),
  });

  // -- P2A: file upload/download --
  router.register('chat.sendFile', {
    input: Requests['chat.sendFile'].input,
    output: Requests['chat.sendFile'].output,
    handler: async ({ conversationId, localPath, tempId }) =>
      svc.sendMediaMessage(conversationId, localPath, tempId),
  });
  router.register('chat.sendFileBytes', {
    input: Requests['chat.sendFileBytes'].input,
    output: Requests['chat.sendFileBytes'].output,
    handler: async ({ conversationId, bytesBase64, name, tempId }) => {
      // Write the pasted bytes to a per-run temp file so the existing
      // upload pipeline can stream from disk. Cleanup is best-effort —
      // OS temp directories auto-prune; we don't track the file beyond
      // the upload.
      const bytes = Buffer.from(bytesBase64, 'base64');
      const dir = join(tmpdir(), 'clawnet-paste');
      await mkdir(dir, { recursive: true });
      // Disambiguate with a timestamp so two pastes in the same tick
      // don't collide.
      const safeName = name.replace(/[\\/]/g, '_');
      const path = join(dir, `${Date.now()}-${safeName}`);
      await writeFile(path, bytes);
      return svc.sendMediaMessage(conversationId, path, tempId);
    },
  });
  router.register('chat.downloadFile', {
    input: Requests['chat.downloadFile'].input,
    output: Requests['chat.downloadFile'].output,
    handler: async ({ fileId, suggestedName }) => {
      const chosen = await deps.showSaveDialog({ suggestedName });
      const dest = chosen ?? join(deps.defaultDownloadsDir(), suggestedName);
      await files.downloadFile(fileId, dest);
      return { savedPath: dest };
    },
  });
  // Tracks in-flight chat.fetchFileForOpen abort controllers keyed by
  // messageId so a user-issued `chat.cancelDownload` can cut the stream.
  const activeDownloads = new Map<string, AbortController>();
  router.register('chat.fetchFileForOpen', {
    input: Requests['chat.fetchFileForOpen'].input,
    output: Requests['chat.fetchFileForOpen'].output,
    handler: async ({ messageId, fileId }) => {
      // Resolve a stable filename from the stored message metadata so
      // re-fetches across app launches hit the same cache slot.
      const msg = deps.store.findMessageById(messageId);
      const rawName =
        (msg?.content as { name?: string } | undefined)?.name ?? `file-${fileId}`;
      const dest = join(deps.mediaCacheDir(), `${messageId}_${safeFileName(rawName)}`);

      if (await fileExists(dest)) {
        // Cache hit — short-circuit; still emit completed so the renderer
        // bubble can flip its label without a polling round-trip.
        deps.emitDownloadCompleted({ messageId, localPath: dest });
        return { localPath: dest };
      }
      // started event fires before response headers, so totalBytes=0 there.
      // Each progress event carries the real Content-Length captured by
      // downloadFileStreaming, so the bubble flips from indeterminate
      // (spinner) to determinate (ring fill) on the first chunk.
      deps.emitDownloadStarted({ messageId, totalBytes: 0 });
      const cancelCtrl = new AbortController();
      activeDownloads.set(messageId, cancelCtrl);
      try {
        await files.downloadFileStreaming(
          fileId,
          dest,
          (bytesReceived, totalBytes) => {
            deps.emitDownloadProgress({ messageId, bytesReceived, totalBytes });
          },
          cancelCtrl.signal,
        );
        deps.emitDownloadCompleted({ messageId, localPath: dest });
        return { localPath: dest };
      } catch (err) {
        const isAbort =
          cancelCtrl.signal.aborted || (err as Error).name === 'AbortError';
        deps.emitDownloadFailed({
          messageId,
          reason: isAbort ? 'cancelled' : (err as Error).message,
        });
        throw err;
      } finally {
        activeDownloads.delete(messageId);
      }
    },
  });
  router.register('chat.cancelUpload', {
    input: Requests['chat.cancelUpload'].input,
    output: Requests['chat.cancelUpload'].output,
    handler: async ({ tempId }) => {
      const cancelled = svc.cancelUpload(tempId);
      return { cancelled };
    },
  });
  router.register('chat.cancelDownload', {
    input: Requests['chat.cancelDownload'].input,
    output: Requests['chat.cancelDownload'].output,
    handler: async ({ messageId }) => {
      const ctrl = activeDownloads.get(messageId);
      if (!ctrl) return { cancelled: false };
      ctrl.abort();
      return { cancelled: true };
    },
  });
  router.register('chat.pickFile', {
    input: Requests['chat.pickFile'].input,
    output: Requests['chat.pickFile'].output,
    handler: async () => {
      const path = await deps.showOpenFileDialog();
      return path ? { path } : null;
    },
  });

  // -- P2C: open (or materialize) a direct conversation with a peer. --
  router.register('chat.createDirectConversation', {
    input: Requests['chat.createDirectConversation'].input,
    output: Requests['chat.createDirectConversation'].output,
    handler: async ({ participantId }) => svc.createDirectConversation(participantId),
  });

  // -- P2D: group conversations + member ops --
  router.register('chat.createGroup', {
    input: Requests['chat.createGroup'].input,
    output: Requests['chat.createGroup'].output,
    handler: async ({ participantIds, title }) =>
      svc.createGroupConversation(participantIds, title),
  });
  router.register('chat.members.list', {
    input: Requests['chat.members.list'].input,
    output: Requests['chat.members.list'].output,
    handler: async ({ conversationId }) => svc.getMembers(conversationId),
  });
  router.register('chat.members.add', {
    input: Requests['chat.members.add'].input,
    output: Requests['chat.members.add'].output,
    handler: async ({ conversationId, participantIds }) =>
      svc.addMembers(conversationId, participantIds),
  });
  router.register('chat.members.remove', {
    input: Requests['chat.members.remove'].input,
    output: Requests['chat.members.remove'].output,
    handler: async ({ conversationId, memberId }) => {
      await svc.removeMember(conversationId, memberId);
    },
  });
  router.register('chat.updateTitle', {
    input: Requests['chat.updateTitle'].input,
    output: Requests['chat.updateTitle'].output,
    handler: async ({ conversationId, title }) =>
      svc.updateConversationTitle(conversationId, title),
  });
  router.register('chat.updateSummary', {
    input: Requests['chat.updateSummary'].input,
    output: Requests['chat.updateSummary'].output,
    handler: async ({ conversationId, summary }) =>
      svc.updateConversationSummary(conversationId, summary),
  });

  // -- P2F: global message search --
  router.register('chat.search.messages', {
    input: Requests['chat.search.messages'].input,
    output: Requests['chat.search.messages'].output,
    handler: async ({ query, conversationId }) =>
      svc.searchMessages(query, conversationId),
  });
}

/** Default electron-backed handler deps. Used by `main/index.ts`; tests
 *  inject their own stubs. The PlaybackEngine + store + download-event
 *  emitters are passed in (rather than pulled from a module-level singleton)
 *  so test setups can swap in fakes. */
export function defaultChatHandlerDeps(
  playbackEngine: PlaybackEngine,
  store: ConversationStoreLike,
  emitters: {
    emitDownloadStarted: ChatHandlerDeps['emitDownloadStarted'];
    emitDownloadProgress: ChatHandlerDeps['emitDownloadProgress'];
    emitDownloadCompleted: ChatHandlerDeps['emitDownloadCompleted'];
    emitDownloadFailed: ChatHandlerDeps['emitDownloadFailed'];
  },
): ChatHandlerDeps {
  return {
    showSaveDialog,
    showOpenFileDialog,
    defaultDownloadsDir: () => app.getPath('downloads'),
    playbackEngine,
    mediaCacheDir: () => AppPaths.mediaCache(),
    store,
    ...emitters,
  };
}
