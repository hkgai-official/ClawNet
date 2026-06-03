import { z } from 'zod';

export const ParticipantTypeSchema = z.enum(['human', 'agent', 'system']);
export type ParticipantType = z.infer<typeof ParticipantTypeSchema>;

// ParticipantRole — ChatModels.swift:12 ("owner | admin | member" per Swift
// comment; nullable on direct conversations and legacy/system rows).
export const ParticipantRoleSchema = z.enum(['owner', 'admin', 'member']);
export type ParticipantRole = z.infer<typeof ParticipantRoleSchema>;

export const ParticipantSchema = z.object({
  id: z.string(),
  name: z.string(),
  // Server returns null for missing optional fields, not undefined — use
  // .nullish() (= .nullable().optional()) so both shapes parse.
  avatar: z.string().nullish(),
  type: ParticipantTypeSchema,
  ownerId: z.string().nullish(),
  ownerName: z.string().nullish(),
  role: ParticipantRoleSchema.nullish(),
});
export type Participant = z.infer<typeof ParticipantSchema>;

export const ConversationTypeSchema = z.enum(['direct', 'group', 'agent_task']);
export type ConversationType = z.infer<typeof ConversationTypeSchema>;

export const ConversationSchema = z.object({
  id: z.string(),
  type: ConversationTypeSchema,
  title: z.string().nullish(),
  summary: z.string().nullish(),
  participants: z.array(ParticipantSchema),
  lastMessagePreview: z.string().nullish(),
  lastMessageAt: z.string().nullish(),
  unreadCount: z.number().int().nonnegative().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const MessageContentTypeSchema = z.enum([
  'text', 'image', 'video', 'voice', 'file', 'system',
  'rich_card', 'dialog_request', 'dialog_approval', 'dialog_status',
  'task_progress', 'task_result', 'approval_request', 'discovery_progress',
]);
export type MessageContentType = z.infer<typeof MessageContentTypeSchema>;

export const MessageStatusSchema = z.enum(['sending', 'sent', 'failed', 'read']);
export type MessageStatus = z.infer<typeof MessageStatusSchema>;

// 1:1 port of macOS `MessageContent` from ChatModels.swift:148-206.
// Wire keys are snake_case (`mime_type`, `thumbnail_url`); HttpClient converts
// them to camelCase on the REST boundary. All fields optional — the type
// discriminator is the parent ChatMessage.contentType. `.passthrough()` is
// retained so card-type raw payloads (dialog_request, task_progress, …)
// survive the schema for downstream consumers.
export const MessageContentSchema = z
  .object({
    text: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    size: z.number().int().nonnegative().nullable().optional(),
    mimeType: z.string().nullable().optional(),
    id: z.string().nullable().optional(),
    thumbnailUrl: z.string().nullable().optional(),
    duration: z.number().nullable().optional(),
  })
  .passthrough();
export type MessageContent = z.infer<typeof MessageContentSchema>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  sender: ParticipantSchema,
  contentType: MessageContentTypeSchema,
  content: MessageContentSchema,
  timestamp: z.string(),
  // Server emits `null` for not-yet-set status; same nullable-vs-optional
  // trap that previously hid the entire conversation list (see P2#1 fix).
  status: MessageStatusSchema.nullish(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const PaginationMetaSchema = z.object({
  page: z.number().int().nonnegative(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;
