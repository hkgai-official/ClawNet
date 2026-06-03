import type { AuthManager } from '../../network/auth-manager';
import type { ConnectionManager } from '../../network/connection-manager';
import type { AuthState } from '../../../shared/domain/auth';
import type { UserInfo } from '../../../shared/domain/user';

export interface AuthServiceOptions {
  authManager: AuthManager;
  connectionManager: ConnectionManager;
  emitState: (s: AuthState) => void;
  fetchCurrentUser?: () => Promise<UserInfo>;
  /** Invoked with the user that just authenticated, BEFORE the
   *  gateway connect kicks off and BEFORE the `loggedIn` state is
   *  broadcast. Lets index.ts diff against the last known user and
   *  wipe local caches if the account changed — keeps user A's
   *  conversations from leaking into user B's session. */
  onLoginSuccess?: (user: UserInfo) => Promise<void> | void;
}

export class AuthService {
  private currentUser: UserInfo | null = null;

  constructor(private readonly opts: AuthServiceOptions) {}

  /** Returns the currently-signed-in user (null when logged out). */
  getCurrentUser(): UserInfo | null {
    return this.currentUser;
  }

  async login(serverURL: string, username: string, password: string): Promise<UserInfo> {
    this.opts.emitState({ kind: 'loggingIn' });
    try {
      this.opts.authManager.updateServerURL(serverURL);
      const user = await this.opts.authManager.login(username, password);
      // Run the user-switch hook BEFORE we connect the gateway so any
      // local-cache wipe completes before WS pushes from the new account
      // start landing in stores.
      await this.opts.onLoginSuccess?.(user);
      try {
        await this.opts.connectionManager.connect();
      } catch {
        // gateway connect failure: still logged in (REST works); connection-manager owns reconnect
      }
      this.currentUser = user;
      this.opts.emitState({ kind: 'loggedIn', user });
      return user;
    } catch (e) {
      this.opts.emitState({ kind: 'loggedOut' });
      throw e;
    }
  }

  async logout(): Promise<void> {
    await this.opts.connectionManager.disconnect();
    await this.opts.authManager.serverLogout();
    this.currentUser = null;
    this.opts.emitState({ kind: 'loggedOut' });
  }

  async restoreSession(): Promise<UserInfo | null> {
    await this.opts.authManager.loadTokensFromStore();
    if (!this.opts.authManager.isAuthenticated()) {
      this.opts.emitState({ kind: 'loggedOut' });
      return null;
    }
    // Priority: explicit injected fetcher (tests) → cached UserInfo
    // persisted at login → manager.fetchCurrentUser (GET /users/me, also
    // re-caches on success) → final `{id:'restored'}` fallback. We try
    // the cache before hitting the network so a slow/offline server
    // still produces the right TitleBar name, and only fall through to
    // /users/me when the cache is empty (e.g. session restored from a
    // build that predates the userInfo cache, OR cache parse failed).
    const explicit = this.opts.fetchCurrentUser
      ? await this.opts.fetchCurrentUser()
      : null;
    const cached = explicit ? null : this.opts.authManager.getCachedUserInfo();
    const fetched = cached ? null : await this.opts.authManager.fetchCurrentUser();
    const user = explicit ?? cached ?? fetched ?? this.fallbackUser();
    // Same user-switch hook the login path uses. Restore is usually the
    // same user (cache stays), but if creds were swapped externally we
    // still want to wipe before connect.
    await this.opts.onLoginSuccess?.(user);
    this.currentUser = user;
    try {
      await this.opts.connectionManager.connect();
    } catch {
      // ditto
    }
    this.opts.emitState({ kind: 'loggedIn', user });
    return user;
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    await this.opts.authManager.changePassword(oldPassword, newPassword);
  }

  updateServerURL(url: string): void {
    this.opts.authManager.updateServerURL(url);
  }

  private fallbackUser(): UserInfo {
    return { id: 'restored', username: 'user' };
  }
}
