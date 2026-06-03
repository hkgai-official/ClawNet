import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from '../auth-slice';

beforeEach(() => {
  useAuthStore.setState({ state: { kind: 'loggedOut' } });
});

describe('useAuthStore', () => {
  it('starts in loggedOut state', () => {
    expect(useAuthStore.getState().state.kind).toBe('loggedOut');
  });

  it('setLoggingIn transitions to loggingIn', () => {
    useAuthStore.getState().setLoggingIn();
    expect(useAuthStore.getState().state.kind).toBe('loggingIn');
  });

  it('setLoggedIn carries user payload', () => {
    useAuthStore.getState().setLoggedIn({ id: 'u1', username: 'a' });
    expect(useAuthStore.getState().state).toMatchObject({
      kind: 'loggedIn',
      user: { id: 'u1' },
    });
  });

  it('setLoggedOut transitions back', () => {
    useAuthStore.getState().setLoggedIn({ id: 'u1', username: 'a' });
    useAuthStore.getState().setLoggedOut();
    expect(useAuthStore.getState().state.kind).toBe('loggedOut');
  });
});
