// e2e/fixtures/stream-script.ts
// A scripted stream: hello_ok → push start → 5 deltas → end → message.created.
// Approximates an Agent reply at ~100 chars/sec.
//
// WS push payload conventions in this codebase (chat-event-handler.ts).
// 2026-05-13: ChatService refactor (58134b0) renamed the topic names from
// `chat.stream.*` / `chat.message.*` to the server-proxied event types:
//   - chat.stream.start    → message.stream_start
//   - chat.stream.delta    → message.stream_delta
//   - chat.stream.end      → message.stream_end
//   - chat.message.created → message.new
// The PushDispatcher fires by frame.topic when the legacy PushFrame envelope
// is used, so we keep `{type:'push', topic, payload}` here and just rename
// the topic strings. Payload shapes (snake_case for stream events,
// ChatMessageSchema-compatible camelCase for message.new) are unchanged.
// agent.command.fileAccess is still subscribed under its original name.

export const HELLO_OK_FRAME = { type: 'hello_ok', protocol: 'v1' };

export const STREAM_TIMELINE: Array<{ delayMs: number; frame: unknown }> = [
  {
    delayMs: 100,
    frame: {
      type: 'push',
      topic: 'message.stream_start',
      payload: {
        message_id: 'r-1',
        conversation_id: 'c-agent',
        sender: { id: 'a-helper', name: 'Helper Agent', type: 'agent' },
      },
    },
  },
  {
    delayMs: 100,
    frame: { type: 'push', topic: 'message.stream_delta', payload: { message_id: 'r-1', delta: 'Hello ' } },
  },
  {
    delayMs: 150,
    frame: { type: 'push', topic: 'message.stream_delta', payload: { message_id: 'r-1', delta: 'there, ' } },
  },
  {
    delayMs: 150,
    frame: { type: 'push', topic: 'message.stream_delta', payload: { message_id: 'r-1', delta: 'how can ' } },
  },
  {
    delayMs: 150,
    frame: { type: 'push', topic: 'message.stream_delta', payload: { message_id: 'r-1', delta: 'I help ' } },
  },
  {
    delayMs: 150,
    frame: { type: 'push', topic: 'message.stream_delta', payload: { message_id: 'r-1', delta: 'you today?' } },
  },
  {
    delayMs: 200,
    frame: {
      type: 'push',
      topic: 'message.stream_end',
      payload: { message_id: 'r-1', final_text: 'Hello there, how can I help you today?' },
    },
  },
  {
    delayMs: 100,
    frame: {
      type: 'push',
      topic: 'message.new',
      payload: {
        id: 'm-agent-1',
        conversationId: 'c-agent',
        sender: { id: 'a-helper', name: 'Helper Agent', type: 'agent' },
        contentType: 'text',
        content: { text: 'Hello there, how can I help you today?' },
        timestamp: new Date().toISOString(),
        status: 'sent',
      },
    },
  },
];

// P2B fixture: a single chat.message.created push carrying a rich_card with
// `card_type=intent_authorization`. Wire format is snake_case (server-emitted);
// chat-event-handler's deepSnakeToCamel will produce a camelCase MessageContent
// when it arrives. `targets[]` items keep snake_case keys per the
// skipKeys: ['targets'] rule (matching macOS RichCardViews.swift:469,471).
export const INTENT_AUTH_TIMELINE: Array<{ delayMs: number; frame: unknown }> = [
  {
    delayMs: 200,
    frame: {
      type: 'push',
      topic: 'message.new',
      payload: {
        id: 'm-intent-auth',
        conversation_id: 'c-agent',
        sender: { id: 'a-helper', name: 'Helper Agent', type: 'agent' },
        content_type: 'rich_card',
        content: {
          card_type: 'intent_authorization',
          authorization_id: 'auth-1',
          agent_name: 'Default',
          status: 'pending',
          targets: [
            { target_user_name: 'Bob', contact_tag_display_name: 'family', topic: 'hello' },
          ],
        },
        timestamp: '2026-05-12T10:00:07Z',
        status: 'sent',
      },
    },
  },
];

export const CONSENT_TIMELINE: Array<{ delayMs: number; frame: unknown }> = [
  {
    delayMs: 200,
    frame: {
      type: 'push',
      topic: 'agent.command.fileAccess',
      payload: {
        request_id: 'req-1',
        agent_id: 'a-helper',
        agent_name: 'Helper Agent',
        path: 'C:\\Users\\e2e\\NewFolder\\data.txt',
        op: 'read',
      },
    },
  },
];
