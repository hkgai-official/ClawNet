import { z } from 'zod';
import { defineRequest, defineEvent } from './_common';
import { ConversationSchema, ChatMessageSchema, PaginationMetaSchema, ParticipantSchema } from '../domain/chat';

export const ChatRequests = {
  'chat.conversations.list': defineRequest({
    input: z.object({}),
    output: z.array(ConversationSchema),
  }),
  'chat.conversations.get': defineRequest({
    input: z.object({ id: z.string() }),
    output: ConversationSchema,
  }),
  'chat.conversations.markRead': defineRequest({
    input: z.object({ id: z.string(), lastReadMessageId: z.string().optional() }),
    output: z.void(),
  }),
  'chat.conversations.delete': defineRequest({
    input: z.object({ id: z.string() }),
    output: z.void(),
  }),
  /** Cancel an in-flight streaming reply. Sends `message.stop` to the
   *  server (mirrors macOS ChatService.abortCurrentRun, which sends a
   *  conversation-scoped envelope) AND drops the local playback-engine
   *  buffer keyed by `messageId` so the typing animation stops
   *  immediately. Both ids are required: `conversationId` for the wire
   *  envelope, `messageId` for the local stream entry. */
  'chat.stream.cancel': defineRequest({
    input: z.object({ messageId: z.string(), conversationId: z.string() }),
    output: z.void(),
  }),
  'chat.messages.list': defineRequest({
    input: z.object({
      conversationId: z.string(),
      page: z.number().int().positive().default(1),
      pageSize: z.number().int().positive().max(200).default(50),
    }),
    output: z.object({
      messages: z.array(ChatMessageSchema),
      meta: PaginationMetaSchema.nullable(),
    }),
  }),
  'chat.messages.sendText': defineRequest({
    input: z.object({
      conversationId: z.string(),
      text: z.string().min(1),
    }),
    output: ChatMessageSchema,
  }),
  'chat.messages.delete': defineRequest({
    input: z.object({ id: z.string(), conversationId: z.string() }),
    output: z.void(),
  }),

  // -- P2A: file upload/download --
  'chat.sendFile': defineRequest({
    input: z.object({
      conversationId: z.string(),
      localPath: z.string(),
      tempId: z.string().optional(),
    }),
    output: ChatMessageSchema,
  }),
  /** Send an in-memory file (e.g. an image pasted from clipboard). Main
   *  writes the bytes to a workspace-local temp path then runs through the
   *  same upload pipeline as `chat.sendFile`. */
  'chat.sendFileBytes': defineRequest({
    input: z.object({
      conversationId: z.string(),
      /** Base64-encoded file bytes (renderer encodes Uint8Array → base64). */
      bytesBase64: z.string(),
      /** Filename for the temp file + the eventual upload metadata. */
      name: z.string().min(1),
      /** MIME hint, e.g. "image/png". Optional — server can sniff. */
      mimeType: z.string().optional(),
      tempId: z.string().optional(),
    }),
    output: ChatMessageSchema,
  }),
  'chat.downloadFile': defineRequest({
    input: z.object({
      fileId: z.string(),
      suggestedName: z.string(),
    }),
    output: z.object({ savedPath: z.string() }),
  }),
  /** Open a native file picker; resolves with the chosen path or null when
   *  the user cancels. Implemented in main via electron `dialog.showOpenDialog`. */
  'chat.pickFile': defineRequest({
    input: z.object({}),
    output: z.object({ path: z.string() }).nullable(),
  }),

  /** Cancel an in-flight upload identified by tempId. The main process
   *  aborts the upload's AbortController; the next chunk fetch rejects with
   *  AbortError → existing `onUploadFailed` path emits `chat.upload.failed`
   *  with reason 'cancelled'. No-op if no upload tracked under tempId. */
  'chat.cancelUpload': defineRequest({
    input: z.object({ tempId: z.string() }),
    output: z.object({ cancelled: z.boolean() }),
  }),

  /** Cancel an in-flight `chat.fetchFileForOpen` download identified by
   *  messageId. Same shape as cancelUpload — emits `chat.download.failed`
   *  with reason 'cancelled' on success. No-op if no download tracked. */
  'chat.cancelDownload': defineRequest({
    input: z.object({ messageId: z.string() }),
    output: z.object({ cancelled: z.boolean() }),
  }),

  // -- P2C: open (or materialize) a direct conversation with a peer.
  // 1:1 with macOS ClawNetAPI.createConversation (ClawNetAPI.swift:35-45). --
  'chat.createDirectConversation': defineRequest({
    input: z.object({ participantId: z.string() }),
    output: ConversationSchema,
  }),

  // -- P2D: group conversations + member ops --
  // 1:1 with macOS ClawNetAPI (ClawNetAPI.swift:35-89).
  'chat.createGroup': defineRequest({
    input: z.object({
      participantIds: z.array(z.string()).min(2),
      title: z.string().optional(),
    }),
    output: ConversationSchema,
  }),
  'chat.members.list': defineRequest({
    input: z.object({ conversationId: z.string() }),
    output: z.array(ParticipantSchema),
  }),
  'chat.members.add': defineRequest({
    input: z.object({
      conversationId: z.string(),
      participantIds: z.array(z.string()).min(1),
    }),
    output: z.array(ParticipantSchema),
  }),
  'chat.members.remove': defineRequest({
    input: z.object({ conversationId: z.string(), memberId: z.string() }),
    output: z.void(),
  }),
  'chat.updateTitle': defineRequest({
    input: z.object({ conversationId: z.string(), title: z.string() }),
    output: ConversationSchema,
  }),
  'chat.updateSummary': defineRequest({
    input: z.object({ conversationId: z.string(), summary: z.string() }),
    output: ConversationSchema,
  }),

  // -- P2F: global message search (ClawNetAPI.swift:157-163) --
  'chat.search.messages': defineRequest({
    input: z.object({ query: z.string(), conversationId: z.string().optional() }),
    output: z.array(ChatMessageSchema),
  }),

  // -- materialize a file to local media-cache for inline viewing --
  'chat.fetchFileForOpen': defineRequest({
    input: z.object({ messageId: z.string(), fileId: z.string() }),
    output: z.object({ localPath: z.string() }),
  }),
} as const;

export const ChatEvents = {
  'chat.message.created': defineEvent(ChatMessageSchema),
  /** Emitted when an optimistic (temp) message is replaced by the real
   *  server-confirmed message. Renderer's useMessages swaps the entry
   *  keyed by tempId for the real ChatMessage. */
  'chat.message.replaced': defineEvent(z.object({
    tempId: z.string(),
    real: ChatMessageSchema,
  })),
  'chat.stream.start': defineEvent(z.object({
    messageId: z.string(),
    conversationId: z.string(),
    sender: ParticipantSchema,
  })),
  'chat.stream.delta': defineEvent(z.object({
    messageId: z.string(),
    content: z.string(),
    seq: z.number().int().nonnegative(),
  })),
  'chat.stream.end': defineEvent(z.object({
    messageId: z.string(),
    conversationId: z.string(),
    sender: ParticipantSchema,
    finalText: z.string().optional(),
  })),
  'chat.stream.cancelled': defineEvent(z.object({
    messageId: z.string(),
  })),

  // -- P2A: upload progress events --
  'chat.upload.progress': defineEvent(z.object({
    tempId: z.string(),
    bytesSent: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
  })),
  'chat.upload.failed': defineEvent(z.object({
    tempId: z.string(),
    reason: z.string(),
  })),

  // -- P2A: download progress events (Task 4) --
  'chat.download.started': defineEvent(z.object({
    messageId: z.string(),
    totalBytes: z.number().int().nonnegative(),
  })),
  'chat.download.progress': defineEvent(z.object({
    messageId: z.string(),
    bytesReceived: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
  })),
  'chat.download.completed': defineEvent(z.object({
    messageId: z.string(),
    localPath: z.string(),
  })),
  'chat.download.failed': defineEvent(z.object({
    messageId: z.string(),
    reason: z.string(),
  })),

  // -- Server push: conversation summary updated (macOS ChatService
  // handleConversationUpdated). Renderer's useConversations patches
  // the cached conversation summary in place. --
  'conversation.updated': defineEvent(z.object({
    conversationId: z.string(),
    summary: z.string(),
  }).passthrough()),

  // -- Server push: group membership change (macOS ChatService
  // handleGroupMembersChanged). action: 'added' | 'removed'. Members
  // is the delta — added members or removed-by-id list. --
  'group.members.changed': defineEvent(z.object({
    conversationId: z.string(),
    action: z.enum(['added', 'removed']),
    members: z.array(z.record(z.unknown())).default([]),
  }).passthrough()),

  // -- Generic "please refetch your conversation list" signal. Emitted
  // from main when `dialog.approval_request` / `dialog.request_sent`
  // push arrives — macOS just calls `loadConversations()` for both.
  // Renderer's useConversations listens and invalidates. --
  'chat.conversations.refresh': defineEvent(z.object({
    cause: z.string(),
  }).passthrough()),
} as const;
