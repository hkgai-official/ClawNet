import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { HttpClient } from '../http-client';
import { ApiError } from '../../core/error';

const BASE = 'http://example.test:9010';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeClient(opts: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}) {
  return new HttpClient({
    baseURL: BASE,
    getAccessToken: async () => 'tok',
    onUnauthorized: async () => true,
    ...opts,
  });
}

describe('HttpClient', () => {
  it('GET injects Bearer header and returns body bytes', async () => {
    server.use(
      http.get(`${BASE}/api/v1/users/me`, ({ request }) => {
        expect(request.headers.get('Authorization')).toBe('Bearer tok');
        return HttpResponse.json({ data: { id: 'u1', display_name: 'A' } });
      }),
    );
    const client = makeClient();
    const data = await client.getJson('/api/v1/users/me');
    expect(data).toMatchObject({ data: { id: 'u1' } });
  });

  it('POST sends JSON body and Content-Type', async () => {
    server.use(
      http.post(`${BASE}/api/v1/auth/login`, async ({ request }) => {
        expect(request.headers.get('Content-Type')).toBe('application/json');
        const body = await request.json() as { email: string };
        expect(body.email).toBe('alice@x.test');
        return HttpResponse.json({ ok: true });
      }),
    );
    const client = makeClient({ getAccessToken: async () => null });
    const data = await client.postJson('/api/v1/auth/login', { email: 'alice@x.test', password: 'p' });
    expect(data).toEqual({ ok: true });
  });

  it('retries once on 401 after onUnauthorized returns true', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/api/v1/users/me`, () => {
        calls += 1;
        if (calls === 1) return new HttpResponse(null, { status: 401 });
        return HttpResponse.json({ data: { id: 'u1' } });
      }),
    );
    const onUnauthorized = vi.fn(async () => true);
    const client = makeClient({ onUnauthorized });
    const data = await client.getJson('/api/v1/users/me');
    expect(calls).toBe(2);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(data).toMatchObject({ data: { id: 'u1' } });
  });

  it('throws ApiError("api.http_401") when onUnauthorized returns false', async () => {
    server.use(
      http.get(`${BASE}/api/v1/users/me`, () => new HttpResponse(null, { status: 401 })),
    );
    const client = makeClient({ onUnauthorized: async () => false });
    await expect(client.getJson('/api/v1/users/me')).rejects.toMatchObject({
      code: 'api.http_401',
    });
  });

  it('throws ApiError on non-2xx (e.g., 500)', async () => {
    server.use(
      http.get(`${BASE}/api/v1/users/me`, () => new HttpResponse('boom', { status: 500 })),
    );
    const client = makeClient();
    await expect(client.getJson('/api/v1/users/me')).rejects.toBeInstanceOf(ApiError);
  });

  it('throws ApiError("api.notAuthenticated") when getAccessToken returns null and route requires auth', async () => {
    const client = makeClient({ getAccessToken: async () => null });
    await expect(client.getJson('/api/v1/users/me')).rejects.toMatchObject({
      code: 'api.notAuthenticated',
    });
  });

  it('skips auth when route is in unauthenticated allow-list (e.g., login)', async () => {
    server.use(
      http.post(`${BASE}/api/v1/auth/login`, ({ request }) => {
        expect(request.headers.get('Authorization')).toBeNull();
        return HttpResponse.json({ ok: true });
      }),
    );
    const client = makeClient({ getAccessToken: async () => null });
    const out = await client.postJson('/api/v1/auth/login', { email: 'a', password: 'b' });
    expect(out).toEqual({ ok: true });
  });
});
