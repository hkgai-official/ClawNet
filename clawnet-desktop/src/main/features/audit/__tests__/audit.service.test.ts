// src/main/features/audit/__tests__/audit.service.test.ts
import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { AuditService } from '../audit.service';
import { HttpClient } from '../../../network/http-client';

const BASE = 'http://example.test:9010';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let svc: AuditService;
beforeEach(() => {
  const httpClient = new HttpClient({ baseURL: BASE, getAccessToken: async () => 'tok' });
  svc = new AuditService({ http: httpClient });
});

const serverEvent = {
  id: 'evt1',
  operation_type: 'file_read',
  agent_id: 'agent-42',
  operation_details: {
    agent_name: 'ResearchBot',
    tag_role: 'researcher',
    path: '/home/user/doc.txt',
    score: 99,           // number — should be filtered out of details
  },
  timestamp: '2026-05-01T00:00:00Z',
};

describe('AuditService.list', () => {
  it('maps server event to AuditEvent domain shape', async () => {
    server.use(
      http.get(`${BASE}/api/v1/audit/events`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('limit')).toBe('10');
        expect(url.searchParams.get('offset')).toBe('0');
        return HttpResponse.json({ status: 'ok', data: [serverEvent] });
      }),
    );

    const events = await svc.list({ limit: 10, offset: 0 });
    expect(events).toHaveLength(1);

    const ev = events[0]!;
    expect(ev.id).toBe('evt1');
    expect(ev.eventType).toBe('audit.file_read');
    expect(ev.agentId).toBe('agent-42');
    expect(ev.agentName).toBe('ResearchBot');
    expect(ev.tagRole).toBe('researcher');
    expect(ev.timestamp).toBe('2026-05-01T00:00:00Z');
    expect(ev.isRead).toBe(true);
    // details: only string-valued entries from operation_details
    expect(ev.details).toEqual({
      agent_name: 'ResearchBot',
      tag_role: 'researcher',
      path: '/home/user/doc.txt',
    });
  });

  it('returns empty array when server returns no events', async () => {
    server.use(
      http.get(`${BASE}/api/v1/audit/events`, () =>
        HttpResponse.json({ status: 'ok', data: [] }),
      ),
    );

    const events = await svc.list({ limit: 5, offset: 20 });
    expect(events).toEqual([]);
  });

  it('accepts the real {success, data, meta} server wrapper', async () => {
    // Wrapper shape captured by live diagnosis on 2026-05-21 against a real
    // ClawNet backend. Previously failed because ListResponseSchema required
    // a `status` field the server doesn't emit.
    server.use(
      http.get(`${BASE}/api/v1/audit/events`, () =>
        HttpResponse.json({
          success: true,
          data: [serverEvent],
          meta: { count: 1 },
        }),
      ),
    );

    const events = await svc.list({ limit: 10, offset: 0 });
    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe('evt1');
    expect(events[0]?.eventType).toBe('audit.file_read');
  });
});
