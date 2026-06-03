// e2e/fixtures/long-stream-script.ts
// Long stream timeline used by 05-stream-perf to assert the renderer keeps
// up with a high-frequency delta feed. ~110 frames * 45ms ≈ 5s; final text
// is ~4950 chars.
//
// MessageList renders bubbles only for messages it knows about (from
// useMessages), so we push `chat.message.created` BEFORE the stream begins
// — its id matches the stream's run_id, allowing MessageBubble's
// useStream(message.id) hook to pick up the streaming content live.
const SEGMENT = 'The quick brown fox jumps over the lazy dog. '; // 45 chars

export const LONG_STREAM_TIMELINE: Array<{ delayMs: number; frame: unknown }> = [
  {
    delayMs: 50,
    frame: {
      type: 'push',
      topic: 'message.new',
      payload: {
        id: 'r-long',
        conversationId: 'c-agent',
        sender: { id: 'a-helper', name: 'Helper Agent', type: 'agent' },
        contentType: 'text',
        content: { text: '' },
        timestamp: new Date().toISOString(),
        status: 'sent',
      },
    },
  },
  {
    delayMs: 50,
    frame: {
      type: 'push',
      topic: 'message.stream_start',
      payload: {
        message_id: 'r-long',
        conversation_id: 'c-agent',
        sender: { id: 'a-helper', name: 'Helper Agent', type: 'agent' },
      },
    },
  },
  ...Array.from({ length: 110 }, () => ({
    delayMs: 45,
    frame: {
      type: 'push',
      topic: 'message.stream_delta',
      payload: { message_id: 'r-long', delta: SEGMENT },
    },
  })),
  {
    delayMs: 100,
    frame: {
      type: 'push',
      topic: 'message.stream_end',
      payload: { message_id: 'r-long', final_text: SEGMENT.repeat(110) },
    },
  },
];
