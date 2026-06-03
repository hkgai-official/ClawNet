import { describe, it, expect } from 'vitest';
import {
  ParticipantSchema, ParticipantTypeSchema, ParticipantRoleSchema,
  ConversationSchema, ConversationTypeSchema,
  MessageContentSchema, MessageContentTypeSchema, MessageStatusSchema,
  ChatMessageSchema,
} from '../chat';

describe('ParticipantSchema', () => {
  it('parses minimal participant', () => {
    const p = ParticipantSchema.parse({ id: 'u1', name: 'Alice', type: 'human' });
    expect(p.type).toBe('human');
  });

  it('accepts optional avatar/ownerId/ownerName/role', () => {
    const p = ParticipantSchema.parse({
      id: 'u1', name: 'Alice', type: 'human',
      avatar: 'x.png', ownerId: 'o1', ownerName: 'O', role: 'admin',
    });
    expect(p.role).toBe('admin');
  });

  it('ParticipantTypeSchema rejects unknown', () => {
    expect(() => ParticipantTypeSchema.parse('robot')).toThrow();
    expect(ParticipantTypeSchema.parse('agent')).toBe('agent');
  });
});

describe('ParticipantRoleSchema (ChatModels.swift:12)', () => {
  it('accepts owner / admin / member', () => {
    for (const r of ['owner', 'admin', 'member']) {
      expect(ParticipantRoleSchema.parse(r)).toBe(r);
    }
  });
  it('rejects unknown roles', () => {
    expect(() => ParticipantRoleSchema.parse('superadmin')).toThrow();
  });
});

describe('ParticipantSchema.role (post-P2D)', () => {
  it('accepts a typed role on a group member', () => {
    const p = ParticipantSchema.parse({
      id: 'u1', name: 'Alice', type: 'human', role: 'owner',
    });
    expect(p.role).toBe('owner');
  });
  it('still parses a participant without role (direct conversations)', () => {
    const p = ParticipantSchema.parse({ id: 'u1', name: 'Alice', type: 'human' });
    expect(p.role).toBeUndefined();
  });
  it('accepts null role (legacy + system messages)', () => {
    const p = ParticipantSchema.parse({ id: 'u1', name: 'Alice', type: 'human', role: null });
    expect(p.role).toBeNull();
  });
  it('rejects free-string roles that drifted in', () => {
    expect(() => ParticipantSchema.parse({
      id: 'u1', name: 'Alice', type: 'human', role: 'guest',
    })).toThrow();
  });
});

describe('ConversationSchema', () => {
  it('parses canonical conversation', () => {
    const c = ConversationSchema.parse({
      id: 'c1', type: 'direct', participants: [
        { id: 'u1', name: 'Alice', type: 'human' },
        { id: 'u2', name: 'Bob', type: 'human' },
      ],
      unreadCount: 0,
      createdAt: '2026-05-01T00:00:00Z',
      updatedAt: '2026-05-01T00:00:00Z',
    });
    expect(c.id).toBe('c1');
    expect(c.unreadCount).toBe(0);
  });

  it('ConversationTypeSchema accepts agent_task', () => {
    expect(ConversationTypeSchema.parse('agent_task')).toBe('agent_task');
  });
});

describe('MessageContentSchema', () => {
  it('text content parses', () => {
    const c = MessageContentSchema.parse({ text: 'hello' });
    expect(c.text).toBe('hello');
  });

  it('passes through unknown rawData', () => {
    const c = MessageContentSchema.parse({ text: 'x', fileId: 'f1', extra: 1 });
    expect((c as { fileId?: string }).fileId).toBe('f1');
  });

  // P2A: media fields ported 1:1 from ChatModels.swift:148-206.
  it('parses a file content with all media fields', () => {
    const c = MessageContentSchema.parse({
      url: 'https://example/f.pdf',
      name: 'f.pdf',
      size: 2048,
      mimeType: 'application/pdf',
      id: 'fid1',
      thumbnailUrl: null,
    });
    expect(c.name).toBe('f.pdf');
    expect(c.size).toBe(2048);
    expect(c.thumbnailUrl).toBeNull();
  });

  it('parses a voice content with duration', () => {
    const c = MessageContentSchema.parse({
      url: 'https://example/v.m4a',
      mimeType: 'audio/m4a',
      duration: 12.5,
    });
    expect(c.duration).toBe(12.5);
  });

  it('rejects negative size', () => {
    expect(() => MessageContentSchema.parse({ size: -1 })).toThrow();
  });
});

describe('ChatMessageSchema', () => {
  it('parses text message', () => {
    const m = ChatMessageSchema.parse({
      id: 'm1', conversationId: 'c1',
      sender: { id: 'u1', name: 'Alice', type: 'human' },
      contentType: 'text',
      content: { text: 'hi' },
      timestamp: '2026-05-01T00:00:00Z',
      status: 'sent',
    });
    expect(m.contentType).toBe('text');
  });

  it('contentType rejects unknown', () => {
    expect(() => MessageContentTypeSchema.parse('lol')).toThrow();
    expect(MessageContentTypeSchema.parse('rich_card')).toBe('rich_card');
  });

  it('status rejects unknown', () => {
    expect(() => MessageStatusSchema.parse('weird')).toThrow();
    expect(MessageStatusSchema.parse('sending')).toBe('sending');
  });
});
