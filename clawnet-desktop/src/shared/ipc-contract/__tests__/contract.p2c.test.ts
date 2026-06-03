import { describe, it, expect } from 'vitest';
import { Requests } from '../index';

describe('P2C IPC contract', () => {
  it('contacts.list shape', () => {
    expect(Requests['contacts.list']).toBeDefined();
    expect(Requests['contacts.list'].input.safeParse({}).success).toBe(true);
  });
  it('contacts.search requires query string', () => {
    expect(Requests['contacts.search'].input.safeParse({ query: 'a' }).success).toBe(true);
    expect(Requests['contacts.search'].input.safeParse({}).success).toBe(false);
  });
  it('contacts.add requires contactId', () => {
    expect(Requests['contacts.add'].input.safeParse({ contactId: 'c1' }).success).toBe(true);
  });
  it('contacts.delete requires contactId', () => {
    expect(Requests['contacts.delete'].input.safeParse({ contactId: 'c1' }).success).toBe(true);
  });
  it('friendRequests.list', () => {
    expect(Requests['friendRequests.list'].input.safeParse({}).success).toBe(true);
  });
  it('friendRequests.send requires toUserId', () => {
    expect(Requests['friendRequests.send'].input.safeParse({ toUserId: 'u1' }).success).toBe(true);
    expect(Requests['friendRequests.send'].input.safeParse({ toUserId: 'u1', message: 'hi' }).success).toBe(true);
  });
  it('friendRequests.accept/reject', () => {
    expect(Requests['friendRequests.accept'].input.safeParse({ id: 'r1' }).success).toBe(true);
    expect(Requests['friendRequests.reject'].input.safeParse({ id: 'r1' }).success).toBe(true);
  });
  it('chat.createDirectConversation requires participantId', () => {
    expect(Requests['chat.createDirectConversation'].input.safeParse({ participantId: 'u1' }).success).toBe(true);
  });
});
