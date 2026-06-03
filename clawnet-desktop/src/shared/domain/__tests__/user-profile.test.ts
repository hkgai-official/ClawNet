// src/shared/domain/__tests__/user-profile.test.ts
import { describe, it, expect } from 'vitest';
import {
  UserProfileSchema,
  UpdateUserProfileInputSchema,
} from '../user-profile';

describe('UserProfileSchema (ClawNetAPI.swift:842-850)', () => {
  it('parses canonical /me response', () => {
    const u = UserProfileSchema.parse({
      id: 'u1',
      displayName: 'Alice',
      avatarUrl: null,
      email: 'alice',
      userCode: '9481',
      phone: null,
      status: 'online',
    });
    expect(u.id).toBe('u1');
    expect(u.displayName).toBe('Alice');
    expect(u.userCode).toBe('9481');
    expect(u.email).toBe('alice');
  });

  it('requires id and displayName', () => {
    expect(() => UserProfileSchema.parse({ id: 'u1' })).toThrow();
    expect(() => UserProfileSchema.parse({ displayName: 'X' })).toThrow();
  });

  it('treats all optional string fields as nullable + optional', () => {
    const u = UserProfileSchema.parse({ id: 'u1', displayName: 'X' });
    expect(u.avatarUrl).toBeUndefined();
    expect(u.email).toBeUndefined();
    expect(u.userCode).toBeUndefined();
    expect(u.phone).toBeUndefined();
    expect(u.status).toBeUndefined();
  });

  it('preserves server-extra fields via .passthrough()', () => {
    const u = UserProfileSchema.parse({
      id: 'u1', displayName: 'X',
      settings: { language: 'zh-Hans' },
      createdAt: '2026-05-01T00:00:00Z',
    }) as Record<string, unknown>;
    expect(u.settings).toBeDefined();
    expect(u.createdAt).toBe('2026-05-01T00:00:00Z');
  });
});

describe('UpdateUserProfileInputSchema', () => {
  it('accepts any subset of displayName/email/avatarUrl', () => {
    expect(UpdateUserProfileInputSchema.safeParse({}).success).toBe(true);
    expect(UpdateUserProfileInputSchema.safeParse({ displayName: 'X' }).success).toBe(true);
    expect(UpdateUserProfileInputSchema.safeParse({ email: 'foo' }).success).toBe(true);
    expect(UpdateUserProfileInputSchema.safeParse({ avatarUrl: 'https://x/a.png' }).success).toBe(true);
  });

  it('rejects empty displayName when key is present', () => {
    const r = UpdateUserProfileInputSchema.safeParse({ displayName: '' });
    expect(r.success).toBe(false);
  });
});
