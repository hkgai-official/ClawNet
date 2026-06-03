import { describe, it, expect } from 'vitest';
import { shouldShowMessageToast } from '../message-toast-policy';
import type { ChatMessage } from '../../../../../shared/domain/chat';

const ME = 'user-me';
const ACTIVE = 'conv-active';

function msg(over: Partial<ChatMessage> & { senderId?: string; senderType?: 'human' | 'agent' | 'system' } = {}): ChatMessage {
  const { senderId = 'user-other', senderType = 'human', ...rest } = over;
  return {
    id: 'm1',
    conversationId: 'conv-other',
    sender: { id: senderId, name: senderId, type: senderType },
    contentType: 'text',
    content: { text: 'hi' } as ChatMessage['content'],
    timestamp: '2026-05-15T00:00:00Z',
    ...rest,
  };
}

describe('shouldShowMessageToast', () => {
  it('toasts a human message in a background conversation', () => {
    expect(shouldShowMessageToast(msg(), ME, ACTIVE)).toBe(true);
  });

  it('does NOT toast an agent-sent message (A2A / agent traffic)', () => {
    expect(shouldShowMessageToast(msg({ senderType: 'agent' }), ME, ACTIVE)).toBe(false);
  });

  it('does NOT toast a system-sent message', () => {
    expect(shouldShowMessageToast(msg({ senderType: 'system' }), ME, ACTIVE)).toBe(false);
  });

  it('does NOT toast the current user’s own message', () => {
    expect(shouldShowMessageToast(msg({ senderId: ME }), ME, ACTIVE)).toBe(false);
  });

  it('does NOT toast a message in the conversation already on screen', () => {
    expect(
      shouldShowMessageToast(msg({ conversationId: ACTIVE }), ME, ACTIVE),
    ).toBe(false);
  });
});
