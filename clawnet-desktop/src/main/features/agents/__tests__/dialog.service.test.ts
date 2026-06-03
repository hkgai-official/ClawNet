// src/main/features/agents/__tests__/dialog.service.test.ts
import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { DialogService } from '../dialog.service';
import { HttpClient } from '../../../network/http-client';

const BASE = 'http://example.test:9010';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let svc: DialogService;
beforeEach(() => {
  const httpClient = new HttpClient({ baseURL: BASE, getAccessToken: async () => 'tok' });
  svc = new DialogService({ http: httpClient });
});

// Mirrors macOS DialogSession (AgentModels.swift:289-307) + real-server
// payload shape captured from /api/v1/agent-dialogs.
const session = {
  id: 's1',
  initiator_agent: { id: 'a1', display_name: 'Init' },
  responder_agent: { id: 'a2', display_name: 'Resp' },
  initiator_owner: { id: 'u1', display_name: 'Alice' },
  responder_owner: { id: 'u2', display_name: 'Bob' },
  topic: 'plan',
  status: 'pending_approval',
  max_rounds: 5,
  current_round: 0,
  conversation_id: 'c1',
  created_at: '2026-05-01T00:00:00Z',
};

describe('DialogService.create', () => {
  it('POSTs to /api/v1/agent-dialogs', async () => {
    server.use(
      http.post(`${BASE}/api/v1/agent-dialogs`, async ({ request }) => {
        const body = await request.json() as { topic: string; max_rounds: number };
        expect(body.topic).toBe('plan');
        expect(body.max_rounds).toBe(5);
        return HttpResponse.json({ data: session });
      }),
    );
    const out = await svc.create({
      initiatorAgentId: 'a1', responderAgentId: 'a2', topic: 'plan', maxRounds: 5,
    });
    expect(out.id).toBe('s1');
  });
});

describe('DialogService.list', () => {
  it('GETs with status filter', async () => {
    server.use(
      http.get(`${BASE}/api/v1/agent-dialogs`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('status')).toBe('pending');
        return HttpResponse.json({ data: { sessions: [session], total: 1 } });
      }),
    );
    const out = await svc.list('pending');
    expect(out).toHaveLength(1);
  });
});

describe('DialogService.getByConv', () => {
  it('returns session or null', async () => {
    server.use(
      http.get(`${BASE}/api/v1/agent-dialogs/by-conversation/c1`, () =>
        HttpResponse.json({ data: session }),
      ),
    );
    const got = await svc.getByConv('c1');
    expect(got?.id).toBe('s1');
  });
});

describe('DialogService.approve', () => {
  it('POSTs with approved + reason', async () => {
    server.use(
      http.post(`${BASE}/api/v1/agent-dialogs/s1/approve`, async ({ request }) => {
        const body = await request.json() as { approved: boolean; reason?: string };
        expect(body.approved).toBe(true);
        expect(body.reason).toBe('ok');
        return HttpResponse.json({});
      }),
    );
    await svc.approve('s1', true, 'ok');
  });
});

describe('DialogService.requestMain', () => {
  it('POSTs to /request-main', async () => {
    server.use(
      http.post(`${BASE}/api/v1/agent-dialogs/s1/request-main`, () => HttpResponse.json({})),
    );
    await svc.requestMain('s1');
  });
});

describe('DialogService.refine', () => {
  it('POSTs target + instruction', async () => {
    server.use(
      http.post(`${BASE}/api/v1/agent-dialogs/s1/refine`, async ({ request }) => {
        const body = await request.json() as { target: string; instruction: string };
        expect(body.target).toBe('main');
        expect(body.instruction).toBe('shorter');
        return HttpResponse.json({});
      }),
    );
    await svc.refine('s1', 'main', 'shorter');
  });
});

describe('DialogService.submitResponse', () => {
  it('POSTs text', async () => {
    server.use(
      http.post(`${BASE}/api/v1/agent-dialogs/s1/submit-response`, async ({ request }) => {
        const body = await request.json() as { text: string };
        expect(body.text).toBe('approved-text');
        return HttpResponse.json({});
      }),
    );
    await svc.submitResponse('s1', 'approved-text');
  });
});

describe('DialogService.terminate', () => {
  it('POSTs with optional reason', async () => {
    server.use(
      http.post(`${BASE}/api/v1/agent-dialogs/s1/terminate`, async ({ request }) => {
        const body = await request.json() as { reason?: string };
        expect(body.reason).toBe('done');
        return HttpResponse.json({});
      }),
    );
    await svc.terminate('s1', 'done');
  });
});

describe('DialogService.extend', () => {
  it('POSTs additional_rounds', async () => {
    server.use(
      http.post(`${BASE}/api/v1/agent-dialogs/s1/extend`, async ({ request }) => {
        const body = await request.json() as { additional_rounds: number };
        expect(body.additional_rounds).toBe(2);
        return HttpResponse.json({});
      }),
    );
    await svc.extend('s1', 2);
  });
});
