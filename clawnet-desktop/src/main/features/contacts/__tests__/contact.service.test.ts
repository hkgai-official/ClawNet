import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { ContactService } from '../contact.service';
import { HttpClient } from '../../../network/http-client';

const BASE = 'http://example.test:9010';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let svc: ContactService;
beforeEach(() => {
  const http_ = new HttpClient({ baseURL: BASE, getAccessToken: async () => 'tok' });
  svc = new ContactService({ http: http_ });
});

const sampleContact = {
  id: 'c1', display_name: 'Alice', type: 'human',
  email: 'a@x', user_code: 'A123',
};

describe('ContactService.list', () => {
  it('GETs /api/v1/contacts and parses Contact[]', async () => {
    server.use(
      http.get(`${BASE}/api/v1/contacts`, () =>
        HttpResponse.json({ data: [sampleContact] }),
      ),
    );
    const out = await svc.list();
    expect(out).toHaveLength(1);
    expect(out[0]?.displayName).toBe('Alice');
    expect(out[0]?.userCode).toBe('A123');
  });
});

describe('ContactService.search', () => {
  it('GETs /api/v1/search/contacts?q= and parses', async () => {
    server.use(
      http.get(`${BASE}/api/v1/search/contacts`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('q')).toBe('alice');
        return HttpResponse.json({ data: [sampleContact] });
      }),
    );
    const out = await svc.search('alice');
    expect(out).toHaveLength(1);
  });

  it('returns [] for empty query without hitting server', async () => {
    // No handler registered — would 500 if hit
    const out = await svc.search('');
    expect(out).toEqual([]);
  });
});

describe('ContactService.add', () => {
  it('POSTs to /api/v1/contacts with snake_case body', async () => {
    server.use(
      http.post(`${BASE}/api/v1/contacts`, async ({ request }) => {
        const body = await request.json() as { contact_id: string; contact_type: string };
        expect(body.contact_id).toBe('c2');
        expect(body.contact_type).toBe('human');
        return HttpResponse.json({ data: { ...sampleContact, id: 'c2' } });
      }),
    );
    const out = await svc.add('c2', 'human');
    expect(out.id).toBe('c2');
  });
});

describe('ContactService.delete', () => {
  it('DELETEs /api/v1/contacts/:id', async () => {
    let called = false;
    server.use(
      http.delete(`${BASE}/api/v1/contacts/c1`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await svc.delete('c1');
    expect(called).toBe(true);
  });
});

const sampleRequest = {
  id: 'r1',
  from_user_id: 'u1', from_user_name: 'Alice',
  to_user_id: 'u2', to_user_name: 'Bob',
  status: 'pending',
  created_at: '2026-05-12T00:00:00Z',
};

describe('ContactService.listFriendRequests', () => {
  it('GETs /api/v1/friend-requests/pending', async () => {
    server.use(
      http.get(`${BASE}/api/v1/friend-requests/pending`, () =>
        HttpResponse.json({ data: [sampleRequest] }),
      ),
    );
    const out = await svc.listFriendRequests();
    expect(out).toHaveLength(1);
    expect(out[0]?.fromUserName).toBe('Alice');
  });
});

describe('ContactService.sendFriendRequest', () => {
  it('POSTs to /api/v1/friend-requests and returns the request', async () => {
    server.use(
      http.post(`${BASE}/api/v1/friend-requests`, async ({ request }) => {
        const body = await request.json() as { to_user_id: string; message?: string };
        expect(body.to_user_id).toBe('u2');
        expect(body.message).toBe('hi');
        return HttpResponse.json({ data: { ...sampleRequest, status: 'pending' } });
      }),
    );
    const out = await svc.sendFriendRequest('u2', 'hi');
    expect(out?.status).toBe('pending');
  });

  it('returns the request with status=accepted when server auto-accepts', async () => {
    // Mirrors ContactService.swift:50-54 — when the other party had already
    // sent us a request, the server short-circuits.
    server.use(
      http.post(`${BASE}/api/v1/friend-requests`, () =>
        HttpResponse.json({ data: { ...sampleRequest, status: 'accepted' } }),
      ),
    );
    const out = await svc.sendFriendRequest('u2');
    expect(out?.status).toBe('accepted');
  });
});

describe('ContactService.acceptFriendRequest', () => {
  it('POSTs to /api/v1/friend-requests/:id/accept', async () => {
    let called = false;
    server.use(
      http.post(`${BASE}/api/v1/friend-requests/r1/accept`, () => {
        called = true; return HttpResponse.json({});
      }),
    );
    await svc.acceptFriendRequest('r1');
    expect(called).toBe(true);
  });
});

describe('ContactService.rejectFriendRequest', () => {
  it('POSTs to /api/v1/friend-requests/:id/reject', async () => {
    let called = false;
    server.use(
      http.post(`${BASE}/api/v1/friend-requests/r1/reject`, () => {
        called = true; return HttpResponse.json({});
      }),
    );
    await svc.rejectFriendRequest('r1');
    expect(called).toBe(true);
  });
});

describe('ContactService.updateTag (ClawNetAPI.swift:508-514)', () => {
  it('PATCHes /api/v1/contacts/:id with tag_id when assigning', async () => {
    server.use(
      http.patch(`${BASE}/api/v1/contacts/c1`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        expect(body.tag_id).toBe('tag-1');
        return HttpResponse.json({ data: { id: 'c1', displayName: 'C', type: 'human', tagId: 'tag-1' } });
      }),
    );
    const c = await svc.updateTag('c1', 'tag-1');
    expect(c.tagId).toBe('tag-1');
  });

  it('sends tag_id: null when unassigning', async () => {
    server.use(
      http.patch(`${BASE}/api/v1/contacts/c1`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        expect(body.tag_id).toBeNull();
        return HttpResponse.json({ data: { id: 'c1', displayName: 'C', type: 'human', tagId: null } });
      }),
    );
    const c = await svc.updateTag('c1', null);
    expect(c.tagId).toBeNull();
  });
});
