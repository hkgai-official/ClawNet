import { describe, it, expect } from 'vitest';
import { Events } from '../index';

describe('IPC contract P1D additions', () => {
  it('includes chat.stream.* events', () => {
    expect(Events['chat.stream.start'].kind).toBe('event');
    expect(Events['chat.stream.delta'].kind).toBe('event');
    expect(Events['chat.stream.end'].kind).toBe('event');
    expect(Events['chat.stream.cancelled'].kind).toBe('event');
  });

  it('chat.stream.delta payload requires messageId + content + seq', () => {
    const ok = Events['chat.stream.delta'].payload.parse({
      messageId: 'm1', content: 'hello', seq: 1,
    });
    expect(ok.content).toBe('hello');
    expect(() => Events['chat.stream.delta'].payload.parse({
      messageId: 'm1', content: 'hello', seq: -1,
    })).toThrow();
  });

  it('chat.stream.end accepts optional finalText', () => {
    const ok = Events['chat.stream.end'].payload.parse({
      messageId: 'm1',
      conversationId: 'c1',
      sender: { id: 'a1', name: 'Agent', type: 'agent' },
    });
    expect(ok.messageId).toBe('m1');
    const withFinal = Events['chat.stream.end'].payload.parse({
      messageId: 'm1',
      conversationId: 'c1',
      sender: { id: 'a1', name: 'Agent', type: 'agent' },
      finalText: 'done',
    });
    expect(withFinal.finalText).toBe('done');
  });
});
