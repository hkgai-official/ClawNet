// src/main/features/agents/__tests__/agent-event-bus.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentEventBus } from '../agent-event-bus';
import { PushDispatcher } from '../../../network/gateway/push';
import { IpcEvents } from '../../../core/ipc-events';

function makeIpc(): { ipc: IpcEvents; broadcasts: Array<{ channel: string; payload: unknown }> } {
  const broadcasts: Array<{ channel: string; payload: unknown }> = [];
  const ipc = new IpcEvents(() => []);
  vi.spyOn(ipc, 'broadcast').mockImplementation((channel, payload) => {
    broadcasts.push({ channel, payload });
  });
  return { ipc, broadcasts };
}

const agentFixture = {
  id: 'a1',
  displayName: 'Helper',
  agentType: 'general',
  status: 'online',
  executionMode: 'hybrid',
  capabilities: [],
  createdAt: '2026-05-01T00:00:00Z',
};

// Fixtures mirror macOS canonical structs (AgentModels.swift:289-419).
const dialogFixture = {
  id: 'd1',
  initiatorAgent: { id: 'a1', displayName: 'Agent A' },
  responderAgent: { id: 'a2', displayName: 'Agent B' },
  initiatorOwner: { id: 'u1', displayName: 'Alice' },
  responderOwner: { id: 'u2', displayName: 'Bob' },
  topic: 'test',
  status: 'pending_approval',
  maxRounds: 5,
  currentRound: 0,
  conversationId: 'c1',
  createdAt: '2026-05-01T00:00:00Z',
};

const discoveryFixture = {
  id: 'dt1',
  sourceConversationId: 'c1',
  initiatorAgentId: 'a1',
  initiatorOwnerId: 'u1',
  status: 'running',
  originalIntent: 'research news',
  maxHops: 3,
  currentHopCount: 0,
  maxConcurrent: 1,
  pendingQueries: [],
  completedResults: [],
  activeSessions: [],
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
};

const serverTaskFixture = {
  id: 'st1',
  agentId: 'a1',
  conversationId: 'c1',
  description: 'Do something',
  priority: 'normal',
  status: 'running',
  createdAt: '2026-05-01T00:00:00Z',
};

const auditFixture = {
  id: 'ev1',
  eventType: 'agent.action',
  timestamp: '2026-05-01T00:00:00Z',
};

const fileAccessFixture = {
  mode: 'full' as const,
  allowedPaths: [],
  deniedPaths: [],
  defaultDeniedPaths: [],
};

describe('AgentEventBus', () => {
  let dispatcher: PushDispatcher;
  let ipc: IpcEvents;
  let broadcasts: Array<{ channel: string; payload: unknown }>;

  beforeEach(() => {
    dispatcher = new PushDispatcher();
    ({ ipc, broadcasts } = makeIpc());
    new AgentEventBus({ dispatcher, events: ipc });
  });

  it('relays agent.updated to IPC broadcast', () => {
    dispatcher.dispatch({ type: 'push', topic: 'agent.updated', payload: agentFixture });
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]?.channel).toBe('agent.updated');
    expect(broadcasts[0]?.payload).toMatchObject({ id: 'a1' });
  });

  it('silently ignores invalid agent.updated payload (no broadcast)', () => {
    dispatcher.dispatch({ type: 'push', topic: 'agent.updated', payload: { bad: true } });
    expect(broadcasts).toHaveLength(0);
  });

  it('relays agent.deleted with id field', () => {
    dispatcher.dispatch({ type: 'push', topic: 'agent.deleted', payload: { id: 'a1' } });
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]?.channel).toBe('agent.deleted');
    expect(broadcasts[0]?.payload).toMatchObject({ id: 'a1' });
  });

  it('relays dialog.draft_updated to IPC broadcast (accumulator payload, snake→camel normalized)', () => {
    // Wire topic is `dialog.draft_updated` (UNDERSCORE) per macOS
    // ChatService.swift:193. The IPC event broadcast toward the
    // renderer is named `dialog.draft.updated` (DOT) for backward
    // compatibility with the existing renderer subscriber.
    dispatcher.dispatch({
      type: 'push',
      topic: 'dialog.draft_updated',
      payload: {
        session_id: 'd1',
        main_draft_text: 'Hello',
        secondary_draft_text: 'Howdy',
        status: 'ready',
      },
    });
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]?.channel).toBe('dialog.draft.updated');
    expect(broadcasts[0]?.payload).toMatchObject({
      sessionId: 'd1',
      mainDraftText: 'Hello',
      secondaryDraftText: 'Howdy',
      status: 'ready',
    });
  });

  it('translates dialog.draft_updated target=tag → secondaryDraftText (refine path)', () => {
    // Server's refine-triggered update has `{session_id, target, draft_text}`
    // rather than the accumulator shape. macOS handleDraftUpdated routes
    // by target (ChatService.swift:1182-1193); the Win port must mirror
    // that or the refined draft never reaches the UI. Regression test
    // for the bug found via spec 43 refine path failure.
    dispatcher.dispatch({
      type: 'push',
      topic: 'dialog.draft_updated',
      payload: {
        session_id: 'd1',
        target: 'tag',
        draft_text: 'Refined friendlier draft',
      },
    });
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]?.channel).toBe('dialog.draft.updated');
    expect(broadcasts[0]?.payload).toMatchObject({
      sessionId: 'd1',
      secondaryDraftText: 'Refined friendlier draft',
      status: 'ready',
    });
  });

  it('translates dialog.draft_updated target=main → mainDraftText', () => {
    dispatcher.dispatch({
      type: 'push',
      topic: 'dialog.draft_updated',
      payload: {
        session_id: 'd1',
        target: 'main',
        draft_text: 'Main draft text',
      },
    });
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]?.channel).toBe('dialog.draft.updated');
    expect(broadcasts[0]?.payload).toMatchObject({
      sessionId: 'd1',
      mainDraftText: 'Main draft text',
      status: 'ready',
    });
  });

  it('drops invalid dialog.draft_updated payload (missing session_id)', () => {
    dispatcher.dispatch({
      type: 'push',
      topic: 'dialog.draft_updated',
      payload: { main_draft_text: 'no session' },
    });
    expect(broadcasts).toHaveLength(0);
  });

  it('does NOT fire on the legacy DOT topic name (regression for round-7 typo fix)', () => {
    dispatcher.dispatch({
      type: 'push',
      topic: 'dialog.draft.updated',
      payload: { session_id: 'd1', main_draft_text: 'Hello', status: 'ready' },
    });
    expect(broadcasts).toHaveLength(0);
  });

  it('relays dialog.completed to IPC broadcast', () => {
    dispatcher.dispatch({ type: 'push', topic: 'dialog.completed', payload: dialogFixture });
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]?.channel).toBe('dialog.completed');
  });

  it('relays discovery.statusChanged to IPC broadcast', () => {
    dispatcher.dispatch({ type: 'push', topic: 'discovery.statusChanged', payload: discoveryFixture });
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]?.channel).toBe('discovery.statusChanged');
    expect(broadcasts[0]?.payload).toMatchObject({ id: 'dt1' });
  });

  it('relays task.statusChanged to IPC broadcast', () => {
    dispatcher.dispatch({ type: 'push', topic: 'task.statusChanged', payload: serverTaskFixture });
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]?.channel).toBe('task.statusChanged');
    expect(broadcasts[0]?.payload).toMatchObject({ id: 'st1' });
  });

  it('relays task.log.appended with taskId and log fields', () => {
    const logEntry = {
      timestamp: 1714521600,
      step: 'task_done',
      level: 'info',
      message: 'step done',
    };
    dispatcher.dispatch({ type: 'push', topic: 'task.log.appended', payload: { taskId: 'st1', log: logEntry } });
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]?.channel).toBe('task.log.appended');
    expect(broadcasts[0]?.payload).toMatchObject({ taskId: 'st1' });
  });

  it('relays audit.event to IPC broadcast', () => {
    dispatcher.dispatch({ type: 'push', topic: 'audit.event', payload: auditFixture });
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]?.channel).toBe('audit.event');
    expect(broadcasts[0]?.payload).toMatchObject({ id: 'ev1' });
  });

  it('relays file_access.changed to fileAccess.changed IPC channel', () => {
    dispatcher.dispatch({ type: 'push', topic: 'file_access.changed', payload: fileAccessFixture });
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]?.channel).toBe('fileAccess.changed');
    expect(broadcasts[0]?.payload).toMatchObject({ mode: 'full' });
  });

  it('silently ignores invalid file_access.changed payload', () => {
    dispatcher.dispatch({ type: 'push', topic: 'file_access.changed', payload: { invalid: true } });
    expect(broadcasts).toHaveLength(0);
  });

  // ── Round-7 push topic alignment ─────────────────────────────────

  it('dialog.status_change → broadcast dialog.status.changed with status field', () => {
    dispatcher.dispatch({
      type: 'push',
      topic: 'dialog.status_change',
      payload: { session_id: 'd1', new_status: 'active', current_round: 2, max_rounds: 5 },
    });
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]?.channel).toBe('dialog.status.changed');
    expect(broadcasts[0]?.payload).toMatchObject({
      sessionId: 'd1',
      status: 'active',
      currentRound: 2,
      maxRounds: 5,
    });
  });

  it('dialog.terminated → broadcast dialog.status.changed with hard-coded status=terminated', () => {
    dispatcher.dispatch({
      type: 'push',
      topic: 'dialog.terminated',
      payload: { session_id: 'd1', reason: 'user_cancel' },
    });
    expect(broadcasts[0]?.payload).toMatchObject({
      sessionId: 'd1',
      status: 'terminated',
      terminationReason: 'user_cancel',
    });
  });

  it('dialog.paused → broadcast dialog.status.changed (no hard-coded status)', () => {
    dispatcher.dispatch({
      type: 'push',
      topic: 'dialog.paused',
      payload: { session_id: 'd1', current_round: 1, max_rounds: 5 },
    });
    expect(broadcasts[0]?.payload).toMatchObject({
      sessionId: 'd1',
      currentRound: 1,
      maxRounds: 5,
    });
    // No status forced here — wire payload didn't have one.
    expect((broadcasts[0]?.payload as { status?: string }).status).toBeUndefined();
  });

  it('dialog.round_complete → broadcast dialog.status.changed with round info', () => {
    dispatcher.dispatch({
      type: 'push',
      topic: 'dialog.round_complete',
      payload: { session_id: 'd1', current_round: 3, max_rounds: 5 },
    });
    expect(broadcasts[0]?.payload).toMatchObject({
      sessionId: 'd1',
      currentRound: 3,
      maxRounds: 5,
    });
  });

  it('dialog.pending_review → broadcast both pending.review + draft.updated', () => {
    dispatcher.dispatch({
      type: 'push',
      topic: 'dialog.pending_review',
      payload: {
        session_id: 'd1',
        conversation_id: 'c1',
        round: 1,
        draft_text: 'hi from tag agent',
        agent_name: 'Tagger',
      },
    });
    expect(broadcasts).toHaveLength(2);
    expect(broadcasts[0]?.channel).toBe('dialog.pending.review');
    expect(broadcasts[0]?.payload).toMatchObject({
      sessionId: 'd1',
      conversationId: 'c1',
      round: 1,
      draftText: 'hi from tag agent',
      agentName: 'Tagger',
    });
    expect(broadcasts[1]?.channel).toBe('dialog.draft.updated');
    expect(broadcasts[1]?.payload).toMatchObject({
      sessionId: 'd1',
      secondaryDraftText: 'hi from tag agent',
      status: 'ready',
    });
  });

  it('dialog.main_draft_ready with sessionId → folds into dialog.draft.updated', () => {
    dispatcher.dispatch({
      type: 'push',
      topic: 'dialog.main_draft_ready',
      payload: { session_id: 'd1', draft_text: 'main' },
    });
    expect(broadcasts[0]?.channel).toBe('dialog.draft.updated');
    expect(broadcasts[0]?.payload).toMatchObject({
      sessionId: 'd1',
      mainDraftText: 'main',
      status: 'ready',
    });
  });

  it('dialog.main_draft_ready without sessionId is dropped (defensive)', () => {
    dispatcher.dispatch({
      type: 'push',
      topic: 'dialog.main_draft_ready',
      payload: { draft_text: 'main' },
    });
    expect(broadcasts).toHaveLength(0);
  });

  it('conversation.updated → broadcast IPC event', () => {
    dispatcher.dispatch({
      type: 'push',
      topic: 'conversation.updated',
      payload: { conversation_id: 'c1', summary: 'Project sync sprint 14' },
    });
    expect(broadcasts[0]).toMatchObject({
      channel: 'conversation.updated',
      payload: { conversationId: 'c1', summary: 'Project sync sprint 14' },
    });
  });

  it('group.members_changed → broadcast group.members.changed', () => {
    dispatcher.dispatch({
      type: 'push',
      topic: 'group.members_changed',
      payload: {
        conversation_id: 'c1',
        action: 'added',
        members: [{ id: 'u3', name: 'Charlie' }],
      },
    });
    expect(broadcasts[0]).toMatchObject({
      channel: 'group.members.changed',
      payload: { conversationId: 'c1', action: 'added' },
    });
  });

  it('friend_request.new → broadcast IPC event', () => {
    dispatcher.dispatch({
      type: 'push',
      topic: 'friend_request.new',
      payload: { from_user_id: 'u9', from_user_name: 'Eve' },
    });
    expect(broadcasts[0]).toMatchObject({
      channel: 'friend_request.new',
      payload: { fromUserId: 'u9', fromUserName: 'Eve' },
    });
  });

  it('friend_request.accepted → broadcast IPC event', () => {
    dispatcher.dispatch({ type: 'push', topic: 'friend_request.accepted', payload: {} });
    expect(broadcasts[0]?.channel).toBe('friend_request.accepted');
  });

  it('dialog.approval_request → broadcast chat.conversations.refresh', () => {
    dispatcher.dispatch({ type: 'push', topic: 'dialog.approval_request', payload: { session_id: 'd1' } });
    expect(broadcasts[0]).toMatchObject({
      channel: 'chat.conversations.refresh',
      payload: { cause: 'dialog.approval_request' },
    });
  });

  it('dialog.request_sent → broadcast dialog.request.sent + chat.conversations.refresh', () => {
    dispatcher.dispatch({
      type: 'push',
      topic: 'dialog.request_sent',
      payload: {
        session_id: 'sess-1',
        conversation_id: 'conv-1',
        topic: 'hello',
        responder_owner: { id: 'u1', display_name: 'Bob' },
        responder_agent: { id: 'a1', display_name: 'friends（助理）' },
      },
    });
    // The new typed event with camelized payload.
    expect(broadcasts).toContainEqual({
      channel: 'dialog.request.sent',
      payload: expect.objectContaining({
        sessionId: 'sess-1',
        conversationId: 'conv-1',
        topic: 'hello',
        responderOwner: expect.objectContaining({ displayName: 'Bob' }),
        responderAgent: expect.objectContaining({ displayName: 'friends（助理）' }),
      }),
    });
    // Legacy refresh signal still fires (consumed by useConversations).
    expect(broadcasts).toContainEqual({
      channel: 'chat.conversations.refresh',
      payload: { cause: 'dialog.request_sent' },
    });
  });

  it('audit.access_denied → re-emits as audit.event with AuditEvent shape', () => {
    dispatcher.dispatch({
      type: 'push',
      topic: 'audit.access_denied',
      payload: {
        id: 'ev-1',
        eventType: 'audit.access_denied',
        agentId: 'a1',
        agentName: 'Helper',
        details: { path: '/etc/secret' },
        timestamp: '2026-05-14T10:00:00Z',
      },
    });
    expect(broadcasts[0]?.channel).toBe('audit.event');
    expect(broadcasts[0]?.payload).toMatchObject({
      id: 'ev-1',
      eventType: 'audit.access_denied',
      agentName: 'Helper',
    });
  });

  it('audit.boundary_violation with sparse payload → synthesizes minimal AuditEvent', () => {
    dispatcher.dispatch({
      type: 'push',
      topic: 'audit.boundary_violation',
      payload: { id: 'ev-2', agent_id: 'a1', agent_name: 'Rogue', timestamp: '2026-05-14T10:00:01Z' },
    });
    expect(broadcasts[0]?.channel).toBe('audit.event');
    expect(broadcasts[0]?.payload).toMatchObject({
      id: 'ev-2',
      eventType: 'audit.boundary_violation',
      agentName: 'Rogue',
    });
  });
});
