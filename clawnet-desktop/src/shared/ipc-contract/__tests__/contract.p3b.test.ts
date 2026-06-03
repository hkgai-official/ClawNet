// src/shared/ipc-contract/__tests__/contract.p3b.test.ts
import { describe, it, expect } from 'vitest';
import { Requests } from '../index';

describe('P3B IPC contract — profile.*', () => {
  it('registers profile.get / .update / .setLanguage', () => {
    expect(Requests['profile.get']).toBeDefined();
    expect(Requests['profile.update']).toBeDefined();
    expect(Requests['profile.setLanguage']).toBeDefined();
  });

  it('profile.update input accepts empty body (no-op PATCH)', () => {
    expect(Requests['profile.update'].input.safeParse({}).success).toBe(true);
  });

  it('profile.update input rejects empty displayName when provided', () => {
    expect(
      Requests['profile.update'].input.safeParse({ displayName: '' }).success,
    ).toBe(false);
  });

  it('profile.update input accepts a single field', () => {
    expect(
      Requests['profile.update'].input.safeParse({ displayName: 'New' }).success,
    ).toBe(true);
    expect(
      Requests['profile.update'].input.safeParse({ email: 'a@b.com' }).success,
    ).toBe(true);
  });

  it('profile.setLanguage input requires a valid Language', () => {
    expect(
      Requests['profile.setLanguage'].input.safeParse({ language: 'en' }).success,
    ).toBe(true);
    expect(
      Requests['profile.setLanguage'].input.safeParse({ language: 'zh-Hans' }).success,
    ).toBe(true);
    expect(
      Requests['profile.setLanguage'].input.safeParse({ language: 'jp' }).success,
    ).toBe(false);
  });
});
