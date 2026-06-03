import { decodeJwt } from 'jose';
import { HttpClient } from './http-client';
import { AppError, AuthError } from '../core/error';
import type { CredentialKey, CredentialStore } from './credential-store';
import type { UserInfo } from '../../shared/domain/user';

export interface AuthManagerOptions {
  serverBaseURL: string;
  credentialStore: CredentialStore;
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export class AuthManager {
  private serverBaseURL: string;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private refreshInFlight: Promise<boolean> | null = null;
  private readonly creds: CredentialStore;
  private readonly http: HttpClient;
  private readonly serverURLListeners: Array<(url: string) => void> = [];

  constructor(opts: AuthManagerOptions) {
    this.serverBaseURL = opts.serverBaseURL;
    this.creds = opts.credentialStore;
    this.http = new HttpClient({
      baseURL: this.serverBaseURL,
      getAccessToken: async () => this.accessToken,
      onUnauthorized: async () => this.refreshAccessToken(),
    });
  }

  /**
   * Register a callback fired whenever the server base URL changes. Used by
   * peer HttpClient instances (chat, agents, audit, file-access) to stay in
   * lockstep with the auth-manager's base URL after the user logs into a
   * different server.
   */
  onServerURLChanged(cb: (url: string) => void): void {
    this.serverURLListeners.push(cb);
  }

  isAuthenticated(): boolean {
    return this.accessToken !== null;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  baseURL(): string {
    return this.serverBaseURL;
  }

  async loadTokensFromStore(): Promise<void> {
    this.accessToken = this.creds.get('accessToken') ?? null;
    this.refreshToken = this.creds.get('refreshToken') ?? null;
    const saved = this.creds.get('serverURL');
    if (saved && saved !== this.serverBaseURL) {
      this.serverBaseURL = saved;
      for (const cb of this.serverURLListeners) cb(this.serverBaseURL);
    }
    this.http.updateBaseURL(this.serverBaseURL);
  }

  async login(email: string, password: string): Promise<UserInfo> {
    let result;
    try {
      result = await this.http.postJson<{
        data: {
          user: { id: string; email?: string; displayName?: string; userCode?: string };
          tokens: { accessToken: string; refreshToken: string };
        };
      }>('/api/v1/auth/login', { email, password });
    } catch (e) {
      throw new AuthError('loginFailed', 'Login failed', e);
    }

    this.accessToken = result.data.tokens.accessToken;
    this.refreshToken = result.data.tokens.refreshToken;
    this.creds.set('accessToken', this.accessToken);
    this.creds.set('refreshToken', this.refreshToken);
    this.creds.set('serverURL', this.serverBaseURL);
    this.creds.set('username', email);

    const u = result.data.user;
    const userInfo: UserInfo = {
      id: u.id,
      username: u.email ?? u.displayName ?? u.id,
      ...(u.displayName !== undefined ? { displayName: u.displayName } : {}),
      ...(u.userCode !== undefined ? { userCode: u.userCode } : {}),
      ...(u.email !== undefined ? { email: u.email } : {}),
    };
    // Persist the full user object so restoreSession can rebuild identity
    // without an extra round-trip and without the `{id:'restored'}` fallback.
    this.creds.set('userInfo', JSON.stringify(userInfo));
    await this.creds.flush();
    return userInfo;
  }

  /** Read the cached UserInfo (if any) — used by restoreSession. */
  getCachedUserInfo(): UserInfo | null {
    const raw = this.creds.get('userInfo');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as UserInfo;
      if (typeof parsed.id !== 'string' || typeof parsed.username !== 'string') return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Fetch the current user from the server. Mirrors macOS
   * ClawNetAPI.getCurrentUser at `api/v1/users/me`. Returns null on any
   * failure (network / not authenticated) so restoreSession falls through
   * to the cached or fallback path.
   *
   * Side effect: when the fetch succeeds, the result is persisted to the
   * `userInfo` credential cache so subsequent restarts can restore identity
   * without a round-trip even if the server is unreachable.
   */
  async fetchCurrentUser(): Promise<UserInfo | null> {
    if (!this.accessToken) return null;
    let result;
    try {
      result = await this.http.getJson<{
        data: { id: string; email?: string; displayName?: string; userCode?: string };
      }>('/api/v1/users/me');
    } catch {
      return null;
    }
    const u = result.data;
    const userInfo: UserInfo = {
      id: u.id,
      username: u.email ?? u.displayName ?? u.id,
      ...(u.displayName !== undefined ? { displayName: u.displayName } : {}),
      ...(u.userCode !== undefined ? { userCode: u.userCode } : {}),
      ...(u.email !== undefined ? { email: u.email } : {}),
    };
    this.creds.set('userInfo', JSON.stringify(userInfo));
    void this.creds.flush();
    return userInfo;
  }

  async ensureValidAccessToken(): Promise<string> {
    if (this.accessToken && this.tokenExpiresInMs(this.accessToken) > FIVE_MINUTES_MS) {
      return this.accessToken;
    }
    const refreshed = await this.refreshAccessToken();
    if (!refreshed || !this.accessToken) {
      throw new AuthError('tokenRefreshFailed', 'Token refresh failed');
    }
    return this.accessToken;
  }

  async refreshAccessToken(): Promise<boolean> {
    if (this.refreshInFlight) return this.refreshInFlight;
    if (!this.refreshToken) return false;

    this.refreshInFlight = (async () => {
      try {
        const result = await this.http.postJson<{
          data: { accessToken: string; refreshToken?: string };
        }>('/api/v1/auth/refresh', { refreshToken: this.refreshToken });

        this.accessToken = result.data.accessToken;
        if (result.data.refreshToken) this.refreshToken = result.data.refreshToken;
        this.creds.set('accessToken', this.accessToken);
        if (this.refreshToken) this.creds.set('refreshToken', this.refreshToken);
        await this.creds.flush();
        return true;
      } catch (e) {
        // Only destroy the saved session when the refresh token is
        // GENUINELY rejected by the server (HTTP 401/403). Transient
        // failures — network blips, 5xx, timeouts — must NOT wipe a
        // still-valid refresh token: doing so logs the user out on a
        // momentary hiccup and the reconnect loop can never recover
        // (it has no token left to retry with). On a transient error
        // we keep the tokens and return false so the caller's backoff
        // loop retries later.
        const code = e instanceof AppError ? e.code : '';
        const isAuthRejection = code === 'api.http_401' || code === 'api.http_403';
        if (isAuthRejection) {
          this.accessToken = null;
          this.refreshToken = null;
          await this.creds.clear();
        }
        return false;
      } finally {
        this.refreshInFlight = null;
      }
    })();

    return this.refreshInFlight;
  }

  async serverLogout(): Promise<void> {
    try {
      if (this.accessToken) await this.http.postJson('/api/v1/auth/logout', {});
    } catch {
      // best-effort
    }
    this.logout();
  }

  logout(): void {
    this.accessToken = null;
    this.refreshToken = null;
    void this.creds.clear();
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    await this.ensureValidAccessToken();
    try {
      await this.http.patchJson('/api/v1/auth/password', {
        oldPassword,
        newPassword,
      });
    } catch (e) {
      const msg = this.extractServerErrorMessage(e) ?? 'Change password failed';
      throw new AuthError('changePasswordFailed', msg, e);
    }
  }

  updateServerURL(newBase: string): void {
    if (newBase === this.serverBaseURL) return;
    this.serverBaseURL = newBase;
    this.http.updateBaseURL(newBase);
    this.creds.set('serverURL', newBase);
    void this.creds.flush();
    for (const cb of this.serverURLListeners) cb(newBase);
  }

  private tokenExpiresInMs(token: string): number {
    try {
      const { exp } = decodeJwt(token);
      if (typeof exp !== 'number') return -Infinity;
      return exp * 1000 - Date.now();
    } catch {
      return -Infinity;
    }
  }

  private extractServerErrorMessage(e: unknown): string | null {
    if (!(e instanceof Error)) return null;
    const m = e.message.match(/"message":\s*"([^"]+)"/);
    return m ? m[1] ?? null : null;
  }
}

export type { CredentialKey };
