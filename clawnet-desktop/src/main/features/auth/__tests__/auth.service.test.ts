import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../auth.service';
import type { AuthState } from '../../../../shared/domain/auth';
import type { UserInfo } from '../../../../shared/domain/user';

class FakeAuthManager {
  loggedIn = false;
  loginImpl: (email: string, pw: string) => Promise<UserInfo> = async () => {
    this.loggedIn = true;
    return { id: 'u1', username: 'alice', displayName: 'Alice' };
  };
  serverLogoutImpl = vi.fn(async () => { this.loggedIn = false; });
  loadTokensFromStore = vi.fn(async () => {});
  isAuthenticated() { return this.loggedIn; }
  async login(e: string, p: string) { return this.loginImpl(e, p); }
  async serverLogout() { await this.serverLogoutImpl(); }
  updateServerURL = vi.fn();
  async changePassword(_old: string, _new: string) {}
  async fetchCurrentUser(): Promise<UserInfo | null> {
    return { id: 'u1', username: 'alice', displayName: 'Alice' };
  }
  cachedUser: UserInfo | null = null;
  getCachedUserInfo(): UserInfo | null { return this.cachedUser; }
}

class FakeConnection {
  connect = vi.fn(async () => {});
  disconnect = vi.fn(async () => {});
  manualReconnect = vi.fn();
}

let am: FakeAuthManager;
let cm: FakeConnection;
let stateEvents: AuthState[];
let svc: AuthService;

beforeEach(() => {
  am = new FakeAuthManager();
  cm = new FakeConnection();
  stateEvents = [];
  svc = new AuthService({
    authManager: am as never,
    connectionManager: cm as never,
    emitState: (s) => stateEvents.push(s),
  });
});

describe('AuthService.login', () => {
  it('emits loggingIn then loggedIn and connects gateway', async () => {
    const user = await svc.login('http://x.test', 'a@x.test', 'p');
    expect(user.id).toBe('u1');
    expect(stateEvents[0]?.kind).toBe('loggingIn');
    expect(stateEvents[stateEvents.length - 1]).toMatchObject({
      kind: 'loggedIn', user: { id: 'u1' },
    });
    expect(cm.connect).toHaveBeenCalled();
  });

  it('emits loggedOut and rethrows on AuthManager.login failure', async () => {
    am.loginImpl = async () => { throw new Error('boom'); };
    await expect(svc.login('http://x.test', 'a', 'p')).rejects.toThrow();
    expect(stateEvents[stateEvents.length - 1]?.kind).toBe('loggedOut');
    expect(cm.connect).not.toHaveBeenCalled();
  });
});

describe('AuthService.logout', () => {
  it('disconnects then revokes server token then clears local', async () => {
    await svc.login('http://x.test', 'a@x.test', 'p');
    stateEvents.length = 0;
    await svc.logout();
    expect(cm.disconnect).toHaveBeenCalled();
    expect(am.serverLogoutImpl).toHaveBeenCalled();
    expect(stateEvents[stateEvents.length - 1]?.kind).toBe('loggedOut');
  });
});

describe('AuthService.restoreSession', () => {
  it('returns user and re-connects when tokens are present', async () => {
    am.loggedIn = true;
    const u = await svc.restoreSession();
    expect(u?.id).toBe('u1');
    expect(cm.connect).toHaveBeenCalled();
    expect(stateEvents[stateEvents.length - 1]?.kind).toBe('loggedIn');
  });

  it('returns null and stays loggedOut when no tokens', async () => {
    am.loggedIn = false;
    const u = await svc.restoreSession();
    expect(u).toBeNull();
    expect(cm.connect).not.toHaveBeenCalled();
    expect(stateEvents[stateEvents.length - 1]?.kind).toBe('loggedOut');
  });
});

describe('AuthService onLoginSuccess hook (cross-account leak guard)', () => {
  it('runs after authManager.login but BEFORE connect() and loggedIn emit', async () => {
    const callOrder: string[] = [];
    am.loginImpl = async () => {
      callOrder.push('authManager.login');
      return { id: 'u1', username: 'alice' };
    };
    cm.connect = vi.fn(async () => {
      callOrder.push('connect');
    });
    svc = new AuthService({
      authManager: am as never,
      connectionManager: cm as never,
      emitState: (s) => {
        if (s.kind === 'loggedIn') callOrder.push('loggedIn');
        stateEvents.push(s);
      },
      onLoginSuccess: async () => {
        callOrder.push('onLoginSuccess');
      },
    });
    await svc.login('http://x.test', 'a', 'p');
    expect(callOrder).toEqual(['authManager.login', 'onLoginSuccess', 'connect', 'loggedIn']);
  });

  it('also fires during restoreSession (covers close-app → relaunch as different account)', async () => {
    am.loggedIn = true;
    const seen: string[] = [];
    svc = new AuthService({
      authManager: am as never,
      connectionManager: cm as never,
      emitState: (s) => stateEvents.push(s),
      onLoginSuccess: async (u) => {
        seen.push(u.id);
      },
    });
    await svc.restoreSession();
    expect(seen).toEqual(['u1']);
  });

  it('a throwing onLoginSuccess hook propagates and prevents loggedIn emit', async () => {
    svc = new AuthService({
      authManager: am as never,
      connectionManager: cm as never,
      emitState: (s) => stateEvents.push(s),
      onLoginSuccess: async () => { throw new Error('cleanup failed'); },
    });
    await expect(svc.login('http://x.test', 'a', 'p')).rejects.toThrow('cleanup failed');
    expect(stateEvents[stateEvents.length - 1]?.kind).toBe('loggedOut');
    expect(cm.connect).not.toHaveBeenCalled();
  });
});
