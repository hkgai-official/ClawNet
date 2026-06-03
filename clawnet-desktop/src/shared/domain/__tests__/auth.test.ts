import { describe, it, expect } from 'vitest';
import { UserInfoSchema } from '../user';
import { AuthStateSchema, ConnectionStatusSchema } from '../auth';

describe('domain/user', () => {
  it('UserInfoSchema parses minimal user', () => {
    const u = UserInfoSchema.parse({ id: 'u1', username: 'alice' });
    expect(u.id).toBe('u1');
    expect(u.username).toBe('alice');
  });

  it('UserInfoSchema accepts optional displayName / userCode / email', () => {
    const u = UserInfoSchema.parse({
      id: 'u1', username: 'alice', displayName: 'Alice', userCode: 'C123', email: 'a@x.test',
    });
    expect(u.displayName).toBe('Alice');
    expect(u.email).toBe('a@x.test');
  });
});

describe('domain/auth', () => {
  it('AuthStateSchema accepts loggedOut variant', () => {
    expect(AuthStateSchema.parse({ kind: 'loggedOut' })).toEqual({ kind: 'loggedOut' });
  });

  it('AuthStateSchema accepts loggingIn variant', () => {
    expect(AuthStateSchema.parse({ kind: 'loggingIn' })).toEqual({ kind: 'loggingIn' });
  });

  it('AuthStateSchema accepts loggedIn variant with user payload', () => {
    const s = AuthStateSchema.parse({
      kind: 'loggedIn',
      user: { id: 'u1', username: 'alice' },
    });
    expect(s).toMatchObject({ kind: 'loggedIn', user: { id: 'u1' } });
  });

  it('ConnectionStatusSchema rejects unknown status', () => {
    expect(() => ConnectionStatusSchema.parse('xxx')).toThrow();
    expect(ConnectionStatusSchema.parse('connected')).toBe('connected');
  });
});
