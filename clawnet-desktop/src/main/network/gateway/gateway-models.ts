import { z } from 'zod';

export const HelloFrameSchema = z.object({
  type: z.literal('hello'),
  role: z.string(),
  scopes: z.array(z.string()),
  caps: z.array(z.string()),
  commands: z.array(z.string()),
  permissions: z.record(z.boolean()),
  client_id: z.string(),
  client_mode: z.string(),
  client_display_name: z.string().optional(),
  device_identity: z.string().optional(),
});
export type HelloFrame = z.infer<typeof HelloFrameSchema>;

export const HelloOkFrameSchema = z.object({
  type: z.literal('hello_ok'),
  protocol: z.string(),
}).passthrough();
export type HelloOkFrame = z.infer<typeof HelloOkFrameSchema>;

// Sent by `/ws/v1/messages` server-proxied flow once the token in the
// query string is validated. Equivalent to hello_ok for the paired flow.
export const AuthSuccessFrameSchema = z.object({
  type: z.literal('auth_success'),
}).passthrough();
export type AuthSuccessFrame = z.infer<typeof AuthSuccessFrameSchema>;

export const PingFrameSchema = z.object({ type: z.literal('ping') });
export const PongFrameSchema = z.object({ type: z.literal('pong') });

// Legacy push wrapper used by the paired-device gateway flow.
// Server-proxied flow (/ws/v1/messages) doesn't wrap events — see
// ServerMessageFrameSchema below.
export const PushFrameSchema = z.object({
  type: z.literal('push'),
  topic: z.string(),
  payload: z.unknown(),
});
export type PushFrame = z.infer<typeof PushFrameSchema>;

// Server-proxied envelope: clawnet server pushes `{type: '<event>', data, request_id?}`
// on /ws/v1/messages. See macOS ServerConnection.swift:130-158 (ServerMessage)
// and ChatService.swift's giant type switch (lines listing message.new,
// message.stream_start, dialog.*, conversation.updated, friend_request.*, etc.).
// We do NOT enumerate the type literals here — any new server event type
// flows through PushDispatcher without a schema upgrade.
export const ServerMessageFrameSchema = z.object({
  type: z.string().refine((s) =>
    // Frames whose `type` is a known connection-lifecycle literal route through
    // the dedicated handlers above; ServerMessage owns everything else.
    s !== 'push' &&
    s !== 'hello' &&
    s !== 'hello_ok' &&
    s !== 'auth_success' &&
    s !== 'ping' &&
    s !== 'pong'
  ),
  data: z.unknown().optional(),
  request_id: z.string().optional(),
}).passthrough();
export type ServerMessageFrame = z.infer<typeof ServerMessageFrameSchema>;

export const RpcRequestFrameSchema = z.object({
  type: z.literal('request'),
  method: z.string().min(1),
  params: z.record(z.unknown()),
});
export type RpcRequestFrame = z.infer<typeof RpcRequestFrameSchema>;

// Connection-lifecycle frames go through the discriminated union; everything
// else flows through ServerMessageFrameSchema. We try lifecycle first (cheap
// literal match), fall through to the open envelope.
export const LifecycleFrameSchema = z.discriminatedUnion('type', [
  HelloFrameSchema,
  HelloOkFrameSchema,
  AuthSuccessFrameSchema,
  PingFrameSchema,
  PongFrameSchema,
  PushFrameSchema,
]);

export const GatewayFrameSchema = z.union([
  LifecycleFrameSchema,
  ServerMessageFrameSchema,
]);
export type GatewayFrame = z.infer<typeof GatewayFrameSchema>;
