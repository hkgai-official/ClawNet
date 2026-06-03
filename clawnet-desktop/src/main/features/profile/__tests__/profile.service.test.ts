// src/main/features/profile/__tests__/profile.service.test.ts
import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { ProfileService } from '../profile.service';
import { HttpClient } from '../../../network/http-client';

const BASE = 'http://example.test:9010';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let httpc: HttpClient;
let svc: ProfileService;
beforeEach(() => {
  httpc = new HttpClient({ baseURL: BASE, getAccessToken: async () => 'tok' });
  svc = new ProfileService({ http: httpc });
});

const meWire = {
  id: 'u1',
  display_name: 'Alice',
  avatar_url: null,
  email: 'alice',
  user_code: '9481',
  phone: null,
  status: 'online',
};

describe('ProfileService.getMe (ClawNetAPI.swift:91-98)', () => {
  it('GETs /api/v1/users/me and parses', async () => {
    server.use(http.get(`${BASE}/api/v1/users/me`, () => HttpResponse.json({ data: meWire })));
    const me = await svc.getMe();
    expect(me.id).toBe('u1');
    expect(me.displayName).toBe('Alice');
    expect(me.userCode).toBe('9481');
    expect(me.email).toBe('alice');
  });
});

describe('ProfileService.updateMe (ClawNetAPI.swift:100-110)', () => {
  it('PATCHes /api/v1/users/me with only provided fields (snake_case body)', async () => {
    server.use(
      http.patch(`${BASE}/api/v1/users/me`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        expect(body.display_name).toBe('NewName');
        expect('email' in body).toBe(false);
        expect('avatar_url' in body).toBe(false);
        return HttpResponse.json({ data: { ...meWire, display_name: 'NewName' } });
      }),
    );
    const me = await svc.updateMe({ displayName: 'NewName' });
    expect(me.displayName).toBe('NewName');
  });

  it('omits a key entirely when the caller does not pass it (no null on wire)', async () => {
    server.use(
      http.patch(`${BASE}/api/v1/users/me`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        expect(body.email).toBe('new@example.com');
        expect('display_name' in body).toBe(false);
        expect('avatar_url' in body).toBe(false);
        return HttpResponse.json({ data: meWire });
      }),
    );
    await svc.updateMe({ email: 'new@example.com' });
  });

  it('accepts empty input (no-op PATCH, server allows)', async () => {
    server.use(
      http.patch(`${BASE}/api/v1/users/me`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        expect(Object.keys(body)).toHaveLength(0);
        return HttpResponse.json({ data: meWire });
      }),
    );
    await svc.updateMe({});
  });
});

describe('ProfileService.setLanguage (ClawNetAPI.swift:112-116)', () => {
  it('PUTs /api/v1/users/me/language with {language: "zh-Hans"}', async () => {
    let bodySeen: Record<string, unknown> | null = null;
    server.use(
      http.put(`${BASE}/api/v1/users/me/language`, async ({ request }) => {
        bodySeen = await request.json() as Record<string, unknown>;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await svc.setLanguage('zh-Hans');
    expect(bodySeen).toEqual({ language: 'zh-Hans' });
  });

  it('accepts en too', async () => {
    let bodySeen: Record<string, unknown> | null = null;
    server.use(
      http.put(`${BASE}/api/v1/users/me/language`, async ({ request }) => {
        bodySeen = await request.json() as Record<string, unknown>;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await svc.setLanguage('en');
    expect(bodySeen).toEqual({ language: 'en' });
  });
});
