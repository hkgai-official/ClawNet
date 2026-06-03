// src/main/features/agents/__tests__/task.service.test.ts
import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { TaskService } from '../task.service';
import { HttpClient } from '../../../network/http-client';

const BASE = 'http://example.test:9010';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let svc: TaskService;
beforeEach(() => {
  const httpClient = new HttpClient({ baseURL: BASE, getAccessToken: async () => 'tok' });
  svc = new TaskService({ http: httpClient });
});

const serverTask = {
  id: 'task1',
  agentId: 'a1',
  conversationId: 'c1',
  description: 'do research',
  priority: 'normal',
  status: 'pending',
  createdAt: '2026-05-01T00:00:00Z',
};

// Mirrors macOS ExecutionLog (AgentModels.swift:387-398): timestamp=epoch
// seconds (Double), step + message required, level enum optional.
const logEntry = {
  timestamp: 1714521660,
  step: 'task_start',
  message: 'Task started',
  level: 'info',
};

describe('TaskService.create', () => {
  it('POSTs to /api/v1/tasks with correct fields', async () => {
    server.use(
      http.post(`${BASE}/api/v1/tasks`, async ({ request }) => {
        const body = await request.json() as {
          agent_id: string;
          conversation_id: string;
          description: string;
          priority: string;
        };
        expect(body.agent_id).toBe('a1');
        expect(body.conversation_id).toBe('c1');
        expect(body.description).toBe('do research');
        expect(body.priority).toBe('normal');
        return HttpResponse.json({ data: serverTask });
      }),
    );
    const out = await svc.create({
      agentId: 'a1',
      conversationId: 'c1',
      description: 'do research',
      priority: 'normal',
    });
    expect(out.id).toBe('task1');
  });
});

describe('TaskService.get', () => {
  it('GETs /api/v1/tasks/:id', async () => {
    server.use(
      http.get(`${BASE}/api/v1/tasks/task1`, () =>
        HttpResponse.json({ data: serverTask }),
      ),
    );
    const out = await svc.get('task1');
    expect(out.description).toBe('do research');
  });
});

describe('TaskService.approve', () => {
  it('POSTs decision + modifications to /api/v1/tasks/:id/approve', async () => {
    server.use(
      http.post(`${BASE}/api/v1/tasks/task1/approve`, async ({ request }) => {
        const body = await request.json() as { decision: string; modifications?: string };
        expect(body).toMatchObject({ decision: 'approve', modifications: 'shorter' });
        return HttpResponse.json({ data: { ...serverTask, status: 'approved' } });
      }),
    );
    const out = await svc.approve('task1', 'approve', 'shorter');
    expect(out.status).toBe('approved');
  });
});

describe('TaskService.cancel', () => {
  it('POSTs to /api/v1/tasks/:id/cancel', async () => {
    server.use(
      http.post(`${BASE}/api/v1/tasks/task1/cancel`, () =>
        HttpResponse.json({ data: { ...serverTask, status: 'cancelled' } }),
      ),
    );
    const out = await svc.cancel('task1');
    expect(out.status).toBe('cancelled');
  });
});

describe('TaskService.getLogs', () => {
  it('GETs /api/v1/tasks/:id/logs', async () => {
    server.use(
      http.get(`${BASE}/api/v1/tasks/task1/logs`, () =>
        HttpResponse.json({ data: [logEntry] }),
      ),
    );
    const logs = await svc.getLogs('task1');
    expect(logs).toHaveLength(1);
    expect(logs[0]?.message).toBe('Task started');
  });
});
