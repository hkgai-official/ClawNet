import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { HttpClient } from '../../network/http-client';
import type { FileService } from '../../network/file-service';
import type { ConversationStoreLike } from '../../store/conversation-store';
import {
  ConversationSchema, ChatMessageSchema, PaginationMetaSchema, ParticipantSchema,
  type Conversation, type ChatMessage, type PaginationMeta, type Participant,
} from '../../../shared/domain/chat';
import { sha256Hex } from '../../utils/crypto';
import { mimeFromExtension, mediaContentType } from '../../utils/mime';
import { ApiError } from '../../core/error';
import { z } from 'zod';

/** Minimal surface the chat service needs from the gateway — keeps test
 *  doubles small. */
export interface ChatGatewayLike {
  sendEnvelope(envelope: { type: string; request_id?: string; data?: Record<string, unknown> }): void;
}

/** Minimal current-user info needed to stamp optimistic message senders
 *  with the right identity (so renderer puts them on the user's side). */
export interface CurrentUserInfo {
  id: string;
  name: string;
}

export interface ChatServiceOptions {
  http: HttpClient;
  store: ConversationStoreLike;
  files: FileService;
  /** Optional. When present, sendText goes through the WS (server triggers
   *  LLM there) instead of POST /api/v1/conversations/{id}/messages (which
   *  only stores the message, doesn't trigger a reply). 1:1 of macOS
   *  ChatService.swift:540-548. */
  getGateway?: () => ChatGatewayLike | null;
  /** Optional. Returns the currently signed-in user so optimistic messages
   *  carry the correct sender.id (otherwise MessageBubble can't decide
   *  which side of the conversation to render them on). */
  getCurrentUser?: () => CurrentUserInfo | null;
  /** Optional hook called after a locally-initiated POST /messages resolves
   *  (sendText / sendMediaMessage). The main DI graph wires this to the IPC
   *  event bus so the renderer message-list reflects user-initiated sends
   *  without waiting for a WS round-trip. Left optional so unit tests don't
   *  have to inject an event sink. */
  onMessageCreated?: (m: ChatMessage) => void;
  /** Per-chunk upload progress hook. Main wires this to `chat.upload.progress`
   *  so the renderer's optimistic bubble can show a determinate progress bar. */
  onUploadProgress?: (e: { tempId: string; bytesSent: number; totalBytes: number }) => void;
  /** Optimistic-to-real swap hook. Main wires this to `chat.message.replaced`
   *  so the renderer's message list can swap the temp bubble for the real one
   *  once the server confirms the message. */
  onMessageReplaced?: (e: { tempId: string; real: ChatMessage }) => void;
  /** Upload-failure hook. Kept separate from a thrown error so the renderer
   *  can flip the bubble into a red Retry state instead of just toasting. */
  onUploadFailed?: (e: { tempId: string; reason: string }) => void;
}

const ConversationsResponseSchema = z.object({ data: z.array(ConversationSchema) });
const ConversationResponseSchema = z.object({ data: ConversationSchema });
const MessagesResponseSchema = z.object({
  data: z.array(ChatMessageSchema),
  meta: PaginationMetaSchema.nullable(),
});
const MessageResponseSchema = z.object({ data: ChatMessageSchema });
const MembersListResponseSchema = z.object({ data: z.array(ParticipantSchema) });
// Search endpoint omits pagination meta — define a tighter response so we
// don't fight `MessagesResponseSchema`'s required `meta` field.
const SearchMessagesResponseSchema = z.object({ data: z.array(ChatMessageSchema) });

export class ChatService {
  private currentSessionId: string | null = null;
  /** Tracks in-flight upload AbortControllers keyed by tempId so a user-issued
   *  `chat.cancelUpload` can cut a running sendMediaMessage mid-stream. */
  private readonly activeUploads = new Map<string, AbortController>();

  constructor(private readonly opts: ChatServiceOptions) {}

  /** Returns the most-recently-active conversation ID (heuristic for ops attribution). */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * Cancel an in-flight upload identified by tempId. Aborts the
   * AbortController so the next `files.uploadChunk` rejects with AbortError;
   * the existing catch path in `sendMediaMessage` then runs as normal
   * (markOptimisticFailed + emit onUploadFailed). Returns true if there was
   * a tracked upload to cancel.
   */
  cancelUpload(tempId: string): boolean {
    const ctrl = this.activeUploads.get(tempId);
    if (!ctrl) return false;
    ctrl.abort();
    // Don't delete here — `sendMediaMessage`'s finally block does the
    // cleanup. Just signal the abort.
    return true;
  }

  async listConversations(): Promise<Conversation[]> {
    const raw = await this.opts.http.getJson<unknown>('/api/v1/conversations');
    const parsed = ConversationsResponseSchema.safeParse(raw);
    if (!parsed.success) {
      console.error('[ChatService] listConversations schema parse failed:', parsed.error.issues.slice(0, 3));
      throw new Error('listConversations: schema validation failed');
    }
    const { data } = parsed.data;
    for (const c of data) this.opts.store.upsertConversation(c);
    return this.opts.store.listConversations();
  }

  async getConversation(id: string): Promise<Conversation> {
    const raw = await this.opts.http.getJson<unknown>(`/api/v1/conversations/${id}`);
    const { data } = ConversationResponseSchema.parse(raw);
    this.opts.store.upsertConversation(data);
    return data;
  }

  /**
   * Materialize (or return existing) direct conversation with the given peer.
   * 1:1 with macOS ClawNetAPI.createConversation (ClawNetAPI.swift:35-45) —
   * type='direct' is the P2C path; server deduplicates so the call is idempotent.
   */
  async createDirectConversation(participantId: string): Promise<Conversation> {
    const raw = await this.opts.http.postJson<unknown>('/api/v1/conversations', {
      type: 'direct',
      participantIds: [participantId],
    });
    const { data } = ConversationResponseSchema.parse(raw);
    this.opts.store.upsertConversation(data);
    return data;
  }

  /**
   * Create a group conversation. 1:1 port of macOS
   * `ClawNetAPI.createConversation` (ClawNetAPI.swift:35-45) with
   * `type: .group`. Requires at least 2 invitees — the caller (self) is
   * implicit on the server side.
   */
  async createGroupConversation(participantIds: string[], title?: string): Promise<Conversation> {
    if (participantIds.length < 2) {
      throw new ApiError('invalid_input', 'createGroupConversation needs at least 2 participantIds');
    }
    const body: Record<string, unknown> = { type: 'group', participantIds };
    if (title !== undefined && title.trim().length > 0) body.title = title;
    const raw = await this.opts.http.postJson<unknown>('/api/v1/conversations', body);
    const { data } = ConversationResponseSchema.parse(raw);
    this.opts.store.upsertConversation(data);
    return data;
  }

  /**
   * List members of a (group) conversation. 1:1 port of
   * `ClawNetAPI.getMembers` (ClawNetAPI.swift:74-78).
   */
  async getMembers(conversationId: string): Promise<Participant[]> {
    const raw = await this.opts.http.getJson<unknown>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/members`,
    );
    return MembersListResponseSchema.parse(raw).data;
  }

  /**
   * Add members to a group conversation. 1:1 port of
   * `ClawNetAPI.addMembers` (ClawNetAPI.swift:80-85). Returns the newly-added
   * participants as the server enriches them with role + display name.
   */
  async addMembers(conversationId: string, participantIds: string[]): Promise<Participant[]> {
    if (participantIds.length < 1) {
      throw new ApiError('invalid_input', 'addMembers needs at least 1 participantId');
    }
    const raw = await this.opts.http.postJson<unknown>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/members`,
      { participantIds },
    );
    return MembersListResponseSchema.parse(raw).data;
  }

  /**
   * Delete (or leave) a conversation. 1:1 port of
   * `ClawNetAPI.deleteConversation` (ClawNetAPI.swift:47-49). The server
   * also emits a `conversation.deleted` event over WS so caches across
   * the renderer invalidate themselves.
   */
  async deleteConversation(id: string): Promise<void> {
    await this.opts.http.deleteJson(`/api/v1/conversations/${encodeURIComponent(id)}`);
    this.opts.store.removeConversation(id);
  }

  /**
   * Cancel an in-flight streaming reply. 1:1 of macOS ChatService.swift
   * abortCurrentRun (ChatService.swift:983-989): sends the
   * `message.stop` envelope keyed by **conversation_id** (NOT message_id)
   * so the server stops generating. Caller is also responsible for
   * invoking the local `playbackEngine.cancel(messageId)` so the typing
   * animation stops immediately even if the server's stream_end is
   * delayed.
   */
  cancelStream(conversationId: string): void {
    const gateway = this.opts.getGateway?.();
    if (!gateway) return;
    gateway.sendEnvelope({
      type: 'message.stop',
      data: { conversation_id: conversationId },
    });
  }

  /**
   * Remove a member from a group. 1:1 port of `ClawNetAPI.removeMember`
   * (ClawNetAPI.swift:87-89).
   */
  async removeMember(conversationId: string, memberId: string): Promise<void> {
    await this.opts.http.deleteJson(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(memberId)}`,
    );
  }

  /**
   * Rename a conversation. 1:1 port of `ClawNetAPI.updateConversation`
   * (ClawNetAPI.swift:60-65).
   */
  async updateConversationTitle(id: string, title: string): Promise<Conversation> {
    const raw = await this.opts.http.patchJson<unknown>(
      `/api/v1/conversations/${encodeURIComponent(id)}`,
      { title },
    );
    const { data } = ConversationResponseSchema.parse(raw);
    this.opts.store.upsertConversation(data);
    return data;
  }

  /**
   * Update conversation summary (AI-generated or user-edited). 1:1 port of
   * `ClawNetAPI.updateConversationSummary` (ClawNetAPI.swift:67-72).
   */
  async updateConversationSummary(id: string, summary: string): Promise<Conversation> {
    const raw = await this.opts.http.patchJson<unknown>(
      `/api/v1/conversations/${encodeURIComponent(id)}`,
      { summary },
    );
    const { data } = ConversationResponseSchema.parse(raw);
    this.opts.store.upsertConversation(data);
    return data;
  }

  async markRead(id: string, lastReadMessageId?: string): Promise<void> {
    const body = lastReadMessageId ? { lastReadMessageId } : {};
    await this.opts.http.postJson(`/api/v1/conversations/${id}/read`, body);
  }

  async listMessages(
    conversationId: string,
    page = 1,
    pageSize = 50,
  ): Promise<{ messages: ChatMessage[]; meta: PaginationMeta | null }> {
    const raw = await this.opts.http.getJson<unknown>(
      `/api/v1/conversations/${conversationId}/messages?page=${page}&page_size=${pageSize}`,
    );
    const { data, meta } = MessagesResponseSchema.parse(raw);
    this.opts.store.appendMessages(conversationId, data);
    return { messages: data, meta };
  }

  async sendText(conversationId: string, text: string): Promise<ChatMessage> {
    this.currentSessionId = conversationId;

    // Preferred path: WS envelope, mirroring macOS ChatService.swift:527-548.
    // Server saves to DB AND triggers LLM reply on this code path; the REST
    // POST below only persists the user's message without invoking an LLM,
    // so without this WS branch the agent never replies.
    const gateway = this.opts.getGateway?.();
    if (gateway) {
      const user = this.opts.getCurrentUser?.() ?? { id: 'self', name: 'You' };
      const sender = { id: user.id, name: user.name, type: 'human' as const };
      const optimistic = this.opts.store.addOptimisticMessage({
        conversationId,
        sender,
        contentType: 'text',
        content: { text },
      });
      gateway.sendEnvelope({
        type: 'message.send',
        request_id: optimistic,
        data: {
          conversation_id: conversationId,
          content_type: 'text',
          content: { text },
        },
      });
      const placeholder = this.opts.store.findMessageById(optimistic);
      if (placeholder) this.opts.onMessageCreated?.(placeholder);
      return placeholder ?? {
        id: optimistic,
        conversationId,
        sender,
        contentType: 'text',
        content: { text },
        timestamp: new Date().toISOString(),
        status: 'sending',
      };
    }

    // Fallback (no gateway / tests): REST POST. Doesn't trigger LLM but at
    // least persists the message so the renderer reflects it.
    const raw = await this.opts.http.postJson<unknown>(
      `/api/v1/conversations/${conversationId}/messages`,
      { contentType: 'text', content: { text } },
    );
    const { data } = MessageResponseSchema.parse(raw);
    this.opts.store.upsertMessage(data);
    this.opts.onMessageCreated?.(data);
    return data;
  }

  async deleteMessage(conversationId: string, id: string): Promise<void> {
    await this.opts.http.deleteJson(`/api/v1/messages/${id}`);
    this.opts.store.deleteMessage(conversationId, id);
  }

  /**
   * Global message search. 1:1 port of macOS `ClawNetAPI.searchMessages` from
   * ClawNet/Networking/ClawNetAPI.swift:157-163.
   *
   * Empty / whitespace-only queries short-circuit to `[]` to avoid a
   * server round-trip + a useless 500 from the backend's regex parser.
   */
  async searchMessages(query: string, conversationId?: string): Promise<ChatMessage[]> {
    if (query.trim().length === 0) return [];
    let path = `/api/v1/search/messages?q=${encodeURIComponent(query)}`;
    if (conversationId) path += `&conversation_id=${encodeURIComponent(conversationId)}`;
    const raw = await this.opts.http.getJson<unknown>(path);
    const { data } = SearchMessagesResponseSchema.parse(raw);
    return data;
  }

  /**
   * Upload a local file (if not already on the server) and post it as a media
   * message. 1:1 port of macOS `ChatService.sendMediaMessage` from
   * ChatService.swift:552-610. Pipeline:
   *
   *   sha256(file) → checkFile(hash)
   *      └─ miss → uploadChunk(hash, i, slice) ×N → completeUpload(hash, …, N)
   *   getFileInfo(id) → POST /messages { content_type, content, client_temp_id }
   *
   * Optimistic-UI insertion lives here (not in the renderer): we insert a
   * placeholder via `store.addOptimisticMessage` BEFORE any network I/O,
   * fire `onMessageCreated` with the placeholder so the bubble appears
   * immediately, emit per-chunk progress through `onUploadProgress`, and
   * either swap to the real message (`onMessageReplaced`) or flip to
   * failed (`onUploadFailed`).
   *
   * The optional `tempId` lets the renderer pre-generate a correlation id so
   * its `useUploadStore` slice can start tracking progress before the IPC
   * round-trip completes. When omitted, the store auto-generates a `temp-*` id.
   */
  async sendMediaMessage(
    conversationId: string,
    localPath: string,
    tempId?: string,
  ): Promise<ChatMessage> {
    this.currentSessionId = conversationId;
    const name = basename(localPath);
    const mime = mimeFromExtension(name);
    const wireContentType = mediaContentType(mime);
    const realTempId = tempId ?? `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Optimistic insert MUST happen before any heavy I/O. Previously we
    // awaited `readFile(localPath)` first, which for a 500 MB video meant
    // 2-3 s of "where's my bubble?" — the bubble only appeared after the
    // bytes were in memory. Now we stat() (millisecond) to get the size,
    // insert the placeholder, emit `chat.message.created`, and only then
    // read the bytes for hashing + chunking.
    const statInfo = await stat(localPath);
    const totalBytes = statInfo.size;

    const user = this.opts.getCurrentUser?.() ?? { id: 'self', name: 'You' };
    const sender = { id: user.id, name: user.name, type: 'human' as const };
    const returnedTempId = this.opts.store.addOptimisticMessage(
      {
        conversationId,
        sender,
        contentType: wireContentType,
        content: {
          name,
          size: totalBytes,
          mimeType: mime,
          // passthrough: lets ImageMessageBubble preview the local file via
          // `file://${localPath}` until the server confirms.
          localPath,
          clientTempId: realTempId,
        },
      },
      realTempId,
    );
    const placeholder = this.opts.store.findMessageById(returnedTempId);
    if (placeholder) this.opts.onMessageCreated?.(placeholder);
    // Yield once so the IPC `chat.message.created` actually drains to the
    // renderer before we kick off CPU-heavy work below. Without this yield
    // the IPC send is queued, sha256Hex monopolizes the event loop, and
    // the bubble effectively renders only after the first chunk's network
    // await — defeating the purpose of the optimistic insert.
    await new Promise<void>((r) => setImmediate(r));

    // Register cancel handle so a parallel chat.cancelUpload can abort the
    // in-flight chunk fetch. Cleared in the finally block below.
    const cancelCtrl = new AbortController();
    this.activeUploads.set(realTempId, cancelCtrl);

    try {
      const buf = await readFile(localPath);
      const hash = sha256Hex(buf);
      let fileId = await this.opts.files.checkFile(hash);
      if (!fileId) {
        const CHUNK = 256 * 1024;
        const totalChunks = Math.max(1, Math.ceil(totalBytes / CHUNK));
        for (let i = 0; i < totalChunks; i++) {
          const slice = buf.subarray(i * CHUNK, Math.min(totalBytes, (i + 1) * CHUNK));
          await this.opts.files.uploadChunk(hash, i, slice, cancelCtrl.signal);
          const bytesSent = Math.min(totalBytes, (i + 1) * CHUNK);
          this.opts.onUploadProgress?.({ tempId: realTempId, bytesSent, totalBytes });
        }
        const completed = await this.opts.files.completeUpload(
          hash, name, totalBytes, mime, totalChunks,
        );
        fileId = completed.id;
      } else {
        // De-dup hit — file already on server; jump straight to 100%.
        this.opts.onUploadProgress?.({
          tempId: realTempId,
          bytesSent: totalBytes,
          totalBytes,
        });
      }
      if (!fileId) throw new ApiError('upload_failed', 'completeUpload returned no id');

      const info = await this.opts.files.getFileInfo(fileId);

      const content: Record<string, unknown> = {
        id: info.id,
        name: info.name,
        size: info.size,
        mimeType: info.mimeType,
      };
      if (info.url) content.url = info.url;
      if (info.thumbnailUrl) content.thumbnailUrl = info.thumbnailUrl;

      // Server ignores any `clientTempId`-style field on the POST body
      // (`grep client_temp_id` in clawnet-server returns 0 hits); the
      // optimistic-to-real swap is driven entirely by the local
      // `replaceOptimistic` call below + `chat.message.replaced` IPC. No
      // need to bloat the wire payload.
      const raw = await this.opts.http.postJson<unknown>(
        `/api/v1/conversations/${conversationId}/messages`,
        { contentType: wireContentType, content },
      );
      const { data: realMessage } = MessageResponseSchema.parse(raw);

      this.opts.store.replaceOptimistic(realTempId, realMessage);
      this.opts.onMessageReplaced?.({ tempId: realTempId, real: realMessage });
      return realMessage;
    } catch (err) {
      this.opts.store.markOptimisticFailed(realTempId);
      // Distinguish user-cancel from server/network failures: AbortError has
      // a stable `name` and the controller's `.signal.aborted` is true.
      const isAbort =
        cancelCtrl.signal.aborted || (err as Error).name === 'AbortError';
      this.opts.onUploadFailed?.({
        tempId: realTempId,
        reason: isAbort ? 'cancelled' : (err as Error).message,
      });
      throw err;
    } finally {
      this.activeUploads.delete(realTempId);
    }
  }
}
