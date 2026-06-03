import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { AuthManager } from '../auth-manager';
import { AuthError } from '../../core/error';
import type { CredentialKey } from '../credential-store';

const BASE = 'http://example.test:9010';

function makeJwt(expEpochSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: expEpochSeconds })).toString('base64url');
  return `${header}.${payload}.sig`;
}

class MemCreds {
  private map = new Map<CredentialKey, string>();
  get(k: CredentialKey) { return this.map.get(k); }
  set(k: CredentialKey, v: string) { this.map.set(k, v); }
  delete(k: CredentialKey) { this.map.delete(k); }
  async load() {}
  async flush() {}
  async clear() { this.map.clear(); }
}

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let creds: MemCreds;
let am: AuthManager;

beforeEach(() => {
  creds = new MemCreds();
  am = new AuthManager({ serverBaseURL: BASE, credentialStore: creds as never });
});

describe('AuthManager.login', () => {
  it('persists tokens and returns UserInfo on success', async () => {
    server.use(
      http.post(`${BASE}/api/v1/auth/login`, async ({ request }) => {
        const body = await request.json() as { email: string; password: string };
        expect(body.email).toBe('alice@x.test');
        return HttpResponse.json({
          data: {
            user: { id: 'u1', email: 'alice@x.test', display_name: 'Alice', user_code: 'C123' },
            tokens: { access_token: makeJwt(future(3600)), refresh_token: 'r1' },
          },
        });
      }),
    );
    const user = await am.login('alice@x.test', 'pw');
    expect(user.id).toBe('u1');
    expect(user.displayName).toBe('Alice');
    expect(am.isAuthenticated()).toBe(true);
    expect(creds.get('accessToken')).toMatch(/^ey/);
    expect(creds.get('refreshToken')).toBe('r1');
  });

  it('throws AuthError("auth.loginFailed") on 401', async () => {
    server.use(
      http.post(`${BASE}/api/v1/auth/login`, () => new HttpResponse(null, { status: 401 })),
    );
    await expect(am.login('alice@x.test', 'wrong')).rejects.toBeInstanceOf(AuthError);
  });
});

describe('AuthManager.ensureValidAccessToken', () => {
  it('returns existing token when expiry > 5 min away', async () => {
    creds.set('accessToken', makeJwt(future(3600)));
    creds.set('refreshToken', 'r1');
    await am.loadTokensFromStore();
    const tok = await am.ensureValidAccessToken();
    expect(tok).toBe(creds.get('accessToken'));
  });

  it('refreshes when token has < 5 min remaining', async () => {
    const oldTok = makeJwt(future(120));
    creds.set('accessToken', oldTok);
    creds.set('refreshToken', 'r1');
    await am.loadTokensFromStore();
    server.use(
      http.post(`${BASE}/api/v1/auth/refresh`, async ({ request }) => {
        const body = await request.json() as { refresh_token: string };
        expect(body.refresh_token).toBe('r1');
        return HttpResponse.json({ data: { access_token: makeJwt(future(3600)), refresh_token: 'r2' } });
      }),
    );
    const tok = await am.ensureValidAccessToken();
    expect(tok).not.toBe(oldTok);
    expect(creds.get('refreshToken')).toBe('r2');
  });

  it('throws AuthError("auth.tokenRefreshFailed") + clears creds when refresh endpoint returns 401', async () => {
    creds.set('accessToken', makeJwt(future(60)));
    creds.set('refreshToken', 'r-bad');
    await am.loadTokensFromStore();
    server.use(
      http.post(`${BASE}/api/v1/auth/refresh`, () => new HttpResponse(null, { status: 401 })),
    );
    await expect(am.ensureValidAccessToken()).rejects.toMatchObject({
      code: 'auth.tokenRefreshFailed',
    });
    // Genuine auth rejection → the refresh token really is dead → wipe it.
    expect(am.isAuthenticated()).toBe(false);
    expect(creds.get('refreshToken')).toBeUndefined();
  });

  it('keeps credentials when refresh fails with a TRANSIENT 5xx (no logout on a server blip)', async () => {
    creds.set('accessToken', makeJwt(future(60)));
    creds.set('refreshToken', 'r-valid');
    await am.loadTokensFromStore();
    server.use(
      http.post(`${BASE}/api/v1/auth/refresh`, () => new HttpResponse(null, { status: 503 })),
    );
    await expect(am.ensureValidAccessToken()).rejects.toMatchObject({
      code: 'auth.tokenRefreshFailed',
    });
    // A 503 is transient — the refresh token is still valid. Wiping it
    // here would log the user out on a momentary server hiccup, then
    // the reconnect loop could never recover.
    expect(creds.get('refreshToken')).toBe('r-valid');
  });

  it('keeps credentials when refresh fails with a network error', async () => {
    creds.set('accessToken', makeJwt(future(60)));
    creds.set('refreshToken', 'r-valid');
    await am.loadTokensFromStore();
    server.use(
      http.post(`${BASE}/api/v1/auth/refresh`, () => HttpResponse.error()),
    );
    await expect(am.ensureValidAccessToken()).rejects.toMatchObject({
      code: 'auth.tokenRefreshFailed',
    });
    // Network blip → keep the token so a later retry can recover.
    expect(creds.get('refreshToken')).toBe('r-valid');
  });
});

describe('AuthManager.serverLogout', () => {
  it('best-effort revokes on server then clears local state', async () => {
    creds.set('accessToken', makeJwt(future(3600)));
    creds.set('refreshToken', 'r1');
    await am.loadTokensFromStore();
    server.use(
      http.post(`${BASE}/api/v1/auth/logout`, () => HttpResponse.json({})),
    );
    await am.serverLogout();
    expect(am.isAuthenticated()).toBe(false);
    expect(creds.get('accessToken')).toBeUndefined();
    expect(creds.get('refreshToken')).toBeUndefined();
  });

  it('clears local state even if server logout fails', async () => {
    creds.set('accessToken', makeJwt(future(3600)));
    creds.set('refreshToken', 'r1');
    await am.loadTokensFromStore();
    server.use(
      http.post(`${BASE}/api/v1/auth/logout`, () => HttpResponse.error()),
    );
    await am.serverLogout();
    expect(am.isAuthenticated()).toBe(false);
  });
});

describe('AuthManager.changePassword', () => {
  it('PATCHes /api/v1/auth/password with old + new, throws with server message on 4xx', async () => {
    creds.set('accessToken', makeJwt(future(3600)));
    await am.loadTokensFromStore();
    server.use(
      http.patch(`${BASE}/api/v1/auth/password`, async ({ request }) => {
        const body = await request.json() as { old_password: string; new_password: string };
        if (body.old_password === 'wrong') {
          return HttpResponse.json(
            { detail: { error: { message: 'Old password incorrect' } } },
            { status: 400 },
          );
        }
        return HttpResponse.json({});
      }),
    );
    await expect(am.changePassword('wrong', 'new')).rejects.toMatchObject({
      code: 'auth.changePasswordFailed',
      message: expect.stringContaining('Old password incorrect'),
    });
    await expect(am.changePassword('right', 'new')).resolves.toBeUndefined();
  });
});

describe('AuthManager.updateServerURL', () => {
  it('updates baseURL and persists', async () => {
    am.updateServerURL('http://new.test:9010');
    expect(creds.get('serverURL')).toBe('http://new.test:9010');
  });
});

function future(seconds: number): number {
  return Math.floor(Date.now() / 1000) + seconds;
}
