// src/main/features/agents/__tests__/discovery.service.test.ts
import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { DiscoveryService } from '../discovery.service';
import { HttpClient } from '../../../network/http-client';

const BASE = 'http://example.test:9010';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let svc: DiscoveryService;
beforeEach(() => {
  const httpClient = new HttpClient({ baseURL: BASE, getAccessToken: async () => 'tok' });
  svc = new DiscoveryService({ http: httpClient });
});

// Mirrors macOS DiscoveryTask (AgentModels.swift:401-419). All fields
// are required per the canonical struct; max_hops / current_hop_count
// / max_concurrent default to small ints in seed data.
const task = {
  id: 'dt1',
  source_conversation_id: 'c1',
  initiator_agent_id: 'a1',
  initiator_owner_id: 'u1',
  status: 'pending_confirmation',
  original_intent: 'market research',
  max_hops: 3,
  current_hop_count: 0,
  max_concurrent: 1,
  pending_queries: [],
  completed_results: [],
  active_sessions: [],
  created_at: '2026-05-01T00:00:00Z',
  updated_at: '2026-05-01T00:00:00Z',
};

describe('DiscoveryService.list', () => {
  it('GETs /api/v1/discovery-tasks with status filter', async () => {
    server.use(
      http.get(`${BASE}/api/v1/discovery-tasks`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('status')).toBe('pending_confirmation');
        return HttpResponse.json({ data: { tasks: [task], total: 1 } });
      }),
    );
    const out = await svc.list('pending_confirmation');
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('dt1');
  });
});

describe('DiscoveryService.get', () => {
  it('GETs /api/v1/discovery-tasks/:id', async () => {
    server.use(
      http.get(`${BASE}/api/v1/discovery-tasks/dt1`, () =>
        HttpResponse.json({ data: task }),
      ),
    );
    const out = await svc.get('dt1');
    expect(out.originalIntent).toBe('market research');
  });
});

describe('DiscoveryService.getByConv', () => {
  it('returns task or null on 404', async () => {
    server.use(
      http.get(`${BASE}/api/v1/discovery-tasks/by-conversation/c1`, () =>
        HttpResponse.json({ data: task }),
      ),
    );
    const got = await svc.getByConv('c1');
    expect(got?.id).toBe('dt1');

    server.resetHandlers();
    server.use(
      http.get(`${BASE}/api/v1/discovery-tasks/by-conversation/c2`, () =>
        HttpResponse.json({ error: 'not found' }, { status: 404 }),
      ),
    );
    const notFound = await svc.getByConv('c2');
    expect(notFound).toBeNull();
  });
});

describe('DiscoveryService.confirm', () => {
  it('POSTs queries to /api/v1/discovery-tasks/:id/confirm', async () => {
    server.use(
      http.post(`${BASE}/api/v1/discovery-tasks/dt1/confirm`, async ({ request }) => {
        const body = await request.json() as { queries?: Array<Record<string, unknown>> };
        expect(body.queries).toEqual([{ q: 'test' }]);
        return HttpResponse.json({ data: { ...task, status: 'confirmed' } });
      }),
    );
    const out = await svc.confirm('dt1', [{ q: 'test' }]);
    expect(out.status).toBe('confirmed');
  });
});

describe('DiscoveryService.cancel', () => {
  it('POSTs reason to /api/v1/discovery-tasks/:id/cancel', async () => {
    server.use(
      http.post(`${BASE}/api/v1/discovery-tasks/dt1/cancel`, async ({ request }) => {
        const body = await request.json() as { reason?: string };
        expect(body.reason).toBe('not needed');
        return HttpResponse.json({ data: { ...task, status: 'cancelled' } });
      }),
    );
    const out = await svc.cancel('dt1', 'not needed');
    expect(out.status).toBe('cancelled');
  });
});
