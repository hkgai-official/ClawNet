// src/shared/ipc-contract/__tests__/contract.p1c.test.ts
import { describe, it, expect } from 'vitest';
import { Requests, Events } from '../index';

describe('IPC contract P1C additions', () => {
  it('includes chat requests', () => {
    expect(Requests['chat.conversations.list'].kind).toBe('request');
    expect(Requests['chat.conversations.get'].kind).toBe('request');
    expect(Requests['chat.conversations.markRead'].kind).toBe('request');
    expect(Requests['chat.messages.list'].kind).toBe('request');
    expect(Requests['chat.messages.sendText'].kind).toBe('request');
    expect(Requests['chat.messages.delete'].kind).toBe('request');
  });

  it('includes chat events', () => {
    expect(Events['chat.message.created'].kind).toBe('event');
  });

  it('chat.messages.list applies pageSize default', () => {
    const v = Requests['chat.messages.list'].input.parse({ conversationId: 'c1' });
    expect(v.page).toBe(1);
    expect(v.pageSize).toBe(50);
  });

  it('chat.messages.sendText rejects empty text', () => {
    expect(() => Requests['chat.messages.sendText'].input.parse({
      conversationId: 'c1', text: '',
    })).toThrow();
  });
});
