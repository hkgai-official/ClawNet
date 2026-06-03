// src/main/features/tags/__tests__/tag.service.test.ts
import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { TagService } from '../tag.service';
import { HttpClient } from '../../../network/http-client';

const BASE = 'http://example.test:9010';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let http_: HttpClient;
let svc: TagService;
beforeEach(() => {
  http_ = new HttpClient({ baseURL: BASE, getAccessToken: async () => 'tok' });
  svc = new TagService({ http: http_ });
});

// Wire-shape fixture — keys are snake_case as the server returns them.
// HttpClient.getJson runs deepSnakeToCamel on the way back, so the service
// parses camelCase. We hand-craft snake_case here to prove the conversion.
const tagWire = {
  id: 'tag-1',
  owner_id: 'u1',
  name: 'workspace',
  display_name: 'Workspace',
  icon: null,
  color: '#7A5CFF',
  is_default: true,
  is_main: false,
  workspace_id: 'ws-1',
  node_acl: { allowed_paths: ['C:\\Users\\alice\\Workspace'], denied_paths: [] },
  created_at: '2026-05-01T00:00:00Z',
  updated_at: '2026-05-01T00:00:00Z',
};

describe('TagService.list (ClawNetAPI.swift:473-477)', () => {
  it('GETs /api/v1/tags and parses', async () => {
    server.use(http.get(`${BASE}/api/v1/tags`, () => HttpResponse.json({ data: [tagWire] })));
    const out = await svc.list();
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('tag-1');
    expect(out[0]?.displayName).toBe('Workspace');
    expect(out[0]?.nodeAcl.allowedPaths).toEqual(['C:\\Users\\alice\\Workspace']);
  });
});

describe('TagService.create (ClawNetAPI.swift:479-489)', () => {
  it('POSTs snake_case body shape with display_name and node_acl', async () => {
    server.use(
      http.post(`${BASE}/api/v1/tags`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        expect(body.display_name).toBe('Team');
        const acl = body.node_acl as Record<string, unknown>;
        expect(acl.allowed_paths).toEqual(['C:\\dev']);
        expect(acl.denied_paths).toEqual([]);
        return HttpResponse.json({ data: { ...tagWire, display_name: 'Team' } });
      }),
    );
    const t = await svc.create({
      displayName: 'Team',
      nodeAcl: { allowedPaths: ['C:\\dev'], deniedPaths: [] },
    });
    expect(t.displayName).toBe('Team');
  });

  it('omits node_acl when nodeAcl is undefined (matches Swift: ACL nil → key absent)', async () => {
    server.use(
      http.post(`${BASE}/api/v1/tags`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        expect('node_acl' in body).toBe(false);
        return HttpResponse.json({ data: tagWire });
      }),
    );
    await svc.create({ displayName: 'NoAcl' });
  });

  it('forwards icon + color when provided', async () => {
    server.use(
      http.post(`${BASE}/api/v1/tags`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        expect(body.icon).toBe('star');
        expect(body.color).toBe('#FF0000');
        return HttpResponse.json({ data: tagWire });
      }),
    );
    await svc.create({ displayName: 'X', icon: 'star', color: '#FF0000' });
  });
});

describe('TagService.update (ClawNetAPI.swift:491-502)', () => {
  it('PATCHes only provided fields', async () => {
    server.use(
      http.patch(`${BASE}/api/v1/tags/tag-1`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        expect(body.display_name).toBe('Renamed');
        expect('icon' in body).toBe(false);
        return HttpResponse.json({ data: { ...tagWire, display_name: 'Renamed' } });
      }),
    );
    const t = await svc.update('tag-1', { displayName: 'Renamed' });
    expect(t.displayName).toBe('Renamed');
  });

  it('forwards node_acl when provided', async () => {
    server.use(
      http.patch(`${BASE}/api/v1/tags/tag-1`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        const acl = body.node_acl as Record<string, unknown>;
        expect(acl.allowed_paths).toEqual(['C:\\new']);
        return HttpResponse.json({ data: tagWire });
      }),
    );
    await svc.update('tag-1', { nodeAcl: { allowedPaths: ['C:\\new'], deniedPaths: [] } });
  });
});

describe('TagService.delete (ClawNetAPI.swift:504-506)', () => {
  it('DELETEs /api/v1/tags/:id', async () => {
    let called = false;
    server.use(http.delete(`${BASE}/api/v1/tags/tag-1`, () => {
      called = true;
      return new HttpResponse(null, { status: 204 });
    }));
    await svc.delete('tag-1');
    expect(called).toBe(true);
  });
});
