import { describe, it, expect } from 'vitest';
import { Requests } from '../index';

describe('P2D IPC contract — group + members', () => {
  it('chat.createGroup requires >=2 participantIds', () => {
    expect(Requests['chat.createGroup'].input.safeParse({ participantIds: ['u1', 'u2'] }).success).toBe(true);
    expect(Requests['chat.createGroup'].input.safeParse({ participantIds: ['u1'] }).success).toBe(false);
    expect(Requests['chat.createGroup'].input.safeParse({ participantIds: ['u1', 'u2'], title: 'Hi' }).success).toBe(true);
  });
  it('chat.members.list shape', () => {
    expect(Requests['chat.members.list'].input.safeParse({ conversationId: 'c1' }).success).toBe(true);
  });
  it('chat.members.add requires >=1 participantId', () => {
    expect(Requests['chat.members.add'].input.safeParse({ conversationId: 'c1', participantIds: ['u1'] }).success).toBe(true);
    expect(Requests['chat.members.add'].input.safeParse({ conversationId: 'c1', participantIds: [] }).success).toBe(false);
  });
  it('chat.members.remove shape', () => {
    expect(Requests['chat.members.remove'].input.safeParse({ conversationId: 'c1', memberId: 'u1' }).success).toBe(true);
  });
  it('chat.updateTitle + chat.updateSummary shapes', () => {
    expect(Requests['chat.updateTitle'].input.safeParse({ conversationId: 'c1', title: 'x' }).success).toBe(true);
    expect(Requests['chat.updateSummary'].input.safeParse({ conversationId: 'c1', summary: 'x' }).success).toBe(true);
  });
});
