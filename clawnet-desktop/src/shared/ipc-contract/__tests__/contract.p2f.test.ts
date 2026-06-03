import { describe, it, expect } from 'vitest';
import { Requests } from '../index';

describe('P2F IPC contract — global search', () => {
  it('chat.search.messages accepts a query, optional conversationId', () => {
    expect(Requests['chat.search.messages'].input.safeParse({ query: 'x' }).success).toBe(true);
    expect(
      Requests['chat.search.messages'].input.safeParse({ query: 'x', conversationId: 'c1' }).success,
    ).toBe(true);
    expect(Requests['chat.search.messages'].input.safeParse({}).success).toBe(false);
  });

  it('files.search requires a query', () => {
    expect(Requests['files.search'].input.safeParse({ query: 'x' }).success).toBe(true);
    expect(Requests['files.search'].input.safeParse({}).success).toBe(false);
  });

  it('contacts.search exists (reused from P2C)', () => {
    expect(Requests['contacts.search']).toBeDefined();
    expect(Requests['contacts.search'].input.safeParse({ query: 'x' }).success).toBe(true);
  });
});
