import { describe, it, expect } from 'vitest';
import {
  ContactSchema, ContactTypeSchema,
  FriendRequestSchema, FriendRequestStatusSchema,
} from '../contact';

describe('ContactTypeSchema (ContactModels.swift:23-26)', () => {
  it('accepts human + agent', () => {
    expect(ContactTypeSchema.parse('human')).toBe('human');
    expect(ContactTypeSchema.parse('agent')).toBe('agent');
  });
  it('rejects unknown', () => {
    expect(() => ContactTypeSchema.parse('robot')).toThrow();
  });
});

describe('ContactSchema (ContactModels.swift:9-27)', () => {
  it('parses minimal contact', () => {
    const c = ContactSchema.parse({
      id: 'c1', displayName: 'Alice', type: 'human',
    });
    expect(c.id).toBe('c1');
  });
  it('parses contact with all optional fields', () => {
    const c = ContactSchema.parse({
      id: 'c1', displayName: 'Alice', type: 'human',
      avatarUrl: 'https://x/a.png', email: 'a@x',
      userCode: 'A123', nickname: 'Ali', phone: '+1',
      status: 'busy', tagId: 't1', tagName: 'family', tagDisplayName: 'Family',
    });
    expect(c.userCode).toBe('A123');
    expect(c.tagDisplayName).toBe('Family');
  });
  it('accepts null for nullable string fields', () => {
    const c = ContactSchema.parse({
      id: 'c1', displayName: 'A', type: 'agent',
      avatarUrl: null, email: null, nickname: null,
    });
    expect(c.avatarUrl).toBeNull();
  });
});

describe('FriendRequestStatusSchema (ContactModels.swift:45-49)', () => {
  it('accepts pending / accepted / rejected; rejects others', () => {
    for (const s of ['pending', 'accepted', 'rejected']) {
      expect(FriendRequestStatusSchema.parse(s)).toBe(s);
    }
    expect(() => FriendRequestStatusSchema.parse('forwarded')).toThrow();
  });
});

describe('FriendRequestSchema (ContactModels.swift:31-50)', () => {
  it('parses minimal pending request', () => {
    const r = FriendRequestSchema.parse({
      id: 'r1',
      fromUserId: 'u1', fromUserName: 'Alice',
      toUserId: 'u2', toUserName: 'Bob',
      status: 'pending',
      createdAt: '2026-05-12T00:00:00Z',
    });
    expect(r.status).toBe('pending');
  });
  it('parses with optional avatar + codes + message', () => {
    const r = FriendRequestSchema.parse({
      id: 'r1',
      fromUserId: 'u1', fromUserName: 'A', fromUserAvatar: 'https://a.png', fromUserCode: 'A1',
      toUserId: 'u2', toUserName: 'B', toUserAvatar: null, toUserCode: null,
      status: 'pending',
      message: 'hi',
      createdAt: '2026-05-12T00:00:00Z',
    });
    expect(r.message).toBe('hi');
    expect(r.toUserAvatar).toBeNull();
  });
});
