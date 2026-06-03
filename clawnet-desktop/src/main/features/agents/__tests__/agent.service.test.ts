// src/main/features/agents/__tests__/agent.service.test.ts
import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { AgentService } from '../agent.service';
import { HttpClient } from '../../../network/http-client';
import { DEFAULT_AGENT_PERMISSIONS } from '../../../../shared/domain/agent';

const BASE = 'http://example.test:9010';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let http_: HttpClient;
let svc: AgentService;
beforeEach(() => {
  http_ = new HttpClient({ baseURL: BASE, getAccessToken: async () => 'tok' });
  svc = new AgentService({ http: http_ });
});

// Field values mirror the real server response shape post-conversion
// (see scripts/smoke-conversion.mjs and macOS AgentModels.swift).
const agentFixture = {
  id: 'a1', displayName: 'Helper', agentType: 'general',
  status: 'online', executionMode: 'hybrid', capabilities: [],
  avatarUrl: null, systemPrompt: null,
  createdAt: '2026-05-01T00:00:00Z',
};

describe('AgentService.list', () => {
  it('GETs /api/v1/agents and parses', async () => {
    server.use(
      http.get(`${BASE}/api/v1/agents`, () => HttpResponse.json({ data: [agentFixture] })),
    );
    const out = await svc.list();
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('a1');
  });
});

describe('AgentService.get', () => {
  it('GETs /api/v1/agents/:id', async () => {
    server.use(
      http.get(`${BASE}/api/v1/agents/a1`, () => HttpResponse.json({ data: agentFixture })),
    );
    const a = await svc.get('a1');
    expect(a.displayName).toBe('Helper');
  });
});

describe('AgentService.contactable', () => {
  it('GETs /api/v1/agents/contactable', async () => {
    server.use(
      http.get(`${BASE}/api/v1/agents/contactable`, () => HttpResponse.json({ data: [agentFixture] })),
    );
    const out = await svc.contactable();
    expect(out).toHaveLength(1);
  });
});

describe('AgentService.createAgent (ClawNetAPI.swift:281-298)', () => {
  it('POSTs the agentConfigToDict body shape with snake_case keys + create-only fields', async () => {
    server.use(
      http.post(`${BASE}/api/v1/agents`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        expect(body.display_name).toBe('Test Bot');
        expect(body.capabilities).toEqual(['file_processing']);
        expect(body.execution_mode).toBe('cloud');
        expect(body.proactive_intensity).toBe('medium');
        // create-only constants from ClawNetAPI.swift:327-330:
        expect(body.agent_type).toBe('general');
        expect(body.interaction_mode).toBe('background');
        // permission_scope dict from AgentPermissions.toScope():
        const perm = body.permission_scope as Record<string, unknown>;
        expect(perm.can_read_files).toBe(true);
        expect(perm.max_concurrent_tasks).toBe(3);
        return HttpResponse.json({ data: agentFixture });
      }),
    );

    const created = await svc.createAgent({
      displayName: 'Test Bot',
      capabilities: ['file_processing'],
      executionMode: 'cloud',
      proactiveIntensity: 'medium',
      permissions: DEFAULT_AGENT_PERMISSIONS,
    });
    expect(created.id).toBe(agentFixture.id);
  });

  it('forwards optional tagId + tagRole', async () => {
    server.use(
      http.post(`${BASE}/api/v1/agents`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        expect(body.tag_id).toBe('tag-1');
        expect(body.tag_role).toBe('delegate');
        return HttpResponse.json({ data: agentFixture });
      }),
    );
    await svc.createAgent(
      { displayName: 'B', capabilities: [], executionMode: 'hybrid', proactiveIntensity: 'low' },
      { tagId: 'tag-1', tagRole: 'delegate' },
    );
  });
});

describe('AgentService.updateAgent (ClawNetAPI.swift:291-298)', () => {
  it('PATCHes /api/v1/agents/:id WITHOUT the agent_type/interaction_mode create-only fields', async () => {
    server.use(
      http.patch(`${BASE}/api/v1/agents/a1`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        expect('agent_type' in body).toBe(false);
        expect('interaction_mode' in body).toBe(false);
        expect(body.display_name).toBe('Renamed');
        return HttpResponse.json({ data: { ...agentFixture, displayName: 'Renamed' } });
      }),
    );
    const updated = await svc.updateAgent('a1', {
      displayName: 'Renamed',
      capabilities: [],
      executionMode: 'hybrid',
      proactiveIntensity: 'medium',
    });
    expect(updated.displayName).toBe('Renamed');
  });
});

describe('AgentService.deleteAgent (ClawNetAPI.swift:334-336)', () => {
  it('DELETEs /api/v1/agents/:id', async () => {
    let called = false;
    server.use(
      http.delete(`${BASE}/api/v1/agents/a1`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await svc.deleteAgent('a1');
    expect(called).toBe(true);
  });
});
