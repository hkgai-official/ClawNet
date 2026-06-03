import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatEventHandler } from '../chat-event-handler';
import { ConversationStore } from '../../../store/conversation-store';
import { PushDispatcher } from '../../../network/gateway/push';
import type { ChatMessage } from '../../../../shared/domain/chat';

class MemKv {
  private m = new Map<string, unknown>();
  get<T>(k: string) { return this.m.get(k) as T | undefined; }
  set(k: string, v: unknown) { this.m.set(k, v); }
}

class FakeEngine {
  starts: unknown[] = [];
  deltas: unknown[] = [];
  ends: unknown[] = [];
  cancelled: unknown[] = [];
  start(runId: string, init: unknown) { this.starts.push({ runId, init }); }
  appendDelta(runId: string, delta: string) { this.deltas.push({ runId, delta }); }
  markComplete(runId: string, finalText?: string) { this.ends.push({ runId, finalText }); }
  cancel(runId: string) { this.cancelled.push({ runId }); }
}

const txt = (id: string, conversationId: string, text: string): ChatMessage => ({
  id, conversationId,
  sender: { id: 'u1', name: 'A', type: 'human' },
  contentType: 'text', content: { text },
  timestamp: '2026-05-01T00:00:00Z', status: 'sent',
});

let store: ConversationStore;
let dispatcher: PushDispatcher;
let emitCreated: ReturnType<typeof vi.fn>;
let engine: FakeEngine;

beforeEach(() => {
  store = new ConversationStore(new MemKv());
  dispatcher = new PushDispatcher();
  emitCreated = vi.fn();
  engine = new FakeEngine();
  new ChatEventHandler({
    store,
    dispatcher,
    engine: engine as never,
    onCreated: emitCreated,
  });
});

describe('ChatEventHandler', () => {
  it('persists message on message.new push', () => {
    const m = txt('m1', 'c1', 'hi');
    dispatcher.dispatchServerMessage({ type: 'message.new', data: m });
    expect(store.listMessages('c1').map((x) => x.id)).toEqual(['m1']);
    expect(emitCreated).toHaveBeenCalledWith(m);
  });

  it('ignores invalid payloads silently', () => {
    dispatcher.dispatchServerMessage({ type: 'message.new', data: { not: 'valid' } });
    expect(store.listMessages('c1')).toHaveLength(0);
    expect(emitCreated).not.toHaveBeenCalled();
  });

  // Task 3 — normalization of WS push payloads via deepSnakeToCamel.
  // Aligns the WS path with HttpClient's REST snake↔camel boundary so the
  // renderer-side typed CardData schemas (card-data.ts) can parse uniformly.
  it('converts snake_case content keys + rawData to camelCase on message.new push', () => {
    dispatcher.dispatchServerMessage({ type: 'message.new', data: {
        id: 'm-task',
        conversation_id: 'c1',
        sender: { id: 'a1', name: 'A', type: 'agent' },
        content_type: 'task_progress',
        content: { name: 'stage', task_id: 't1', stage: 'analyzing', progress: 42 },
        timestamp: '2026-05-12T00:00:00Z',
      },
    });
    const m = store.listMessages('c1').find((x) => x.id === 'm-task');
    expect(m).toBeDefined();
    expect(m?.conversationId).toBe('c1');
    expect(m?.contentType).toBe('task_progress'); // rawValue, not key — stays snake
    const content = m?.content as Record<string, unknown>;
    expect(content.taskId).toBe('t1');
    expect(content.stage).toBe('analyzing');
    expect(content.progress).toBe(42);
  });

  it('preserves snake_case inside intent_authorization targets[] (macOS-parity skipKey)', () => {
    dispatcher.dispatchServerMessage({ type: 'message.new', data: {
        id: 'm-intent',
        conversation_id: 'c1',
        sender: { id: 'a1', name: 'A', type: 'agent' },
        content_type: 'rich_card',
        content: {
          card_type: 'intent_authorization',
          authorization_id: 'auth-1',
          targets: [
            { target_user_name: 'Bob', contact_tag_display_name: 'family' },
          ],
        },
        timestamp: '2026-05-12T00:00:00Z',
      },
    });
    const m = store.listMessages('c1').find((x) => x.id === 'm-intent');
    expect(m).toBeDefined();
    const content = m?.content as Record<string, unknown>;
    expect(content.cardType).toBe('intent_authorization');
    expect(content.authorizationId).toBe('auth-1');
    const targets = content.targets as Array<Record<string, unknown>>;
    expect(targets[0]?.target_user_name).toBe('Bob'); // ← stays snake_case
    expect(targets[0]?.contact_tag_display_name).toBe('family');
  });

});

describe('ChatEventHandler streaming integration', () => {
  it('message.stream_start calls engine.start with run metadata', () => {
    dispatcher.dispatchServerMessage({ type: 'message.stream_start', data: {
        message_id: 'r1',
        conversation_id: 'c1',
        sender: { id: 'a1', name: 'Agent', type: 'agent' },
      },
    });
    expect(engine.starts).toHaveLength(1);
    expect(engine.starts[0]).toMatchObject({
      runId: 'r1',
      init: { conversationId: 'c1', sender: { id: 'a1' } },
    });
  });

  it('message.stream_delta calls engine.appendDelta', () => {
    dispatcher.dispatchServerMessage({ type: 'message.stream_delta', data: { message_id: 'r1', delta: 'hello' },
    });
    expect(engine.deltas).toEqual([{ runId: 'r1', delta: 'hello' }]);
  });

  it('message.stream_end calls engine.markComplete with finalText', () => {
    dispatcher.dispatchServerMessage({ type: 'message.stream_end', data: { message_id: 'r1', final_text: 'hi there' },
    });
    expect(engine.ends).toEqual([{ runId: 'r1', finalText: 'hi there' }]);
  });

  it('message.stop calls engine.cancel', () => {
    dispatcher.dispatchServerMessage({ type: 'message.stop', data: { message_id: 'r1' },
    });
    expect(engine.cancelled).toEqual([{ runId: 'r1' }]);
  });

  it('invalid stream payload is ignored', () => {
    dispatcher.dispatchServerMessage({ type: 'message.stream_start', data: { not: 'valid' },
    });
    expect(engine.starts).toHaveLength(0);
  });
});

describe('ChatEventHandler — desktop notifications (G3)', () => {
  function setup(opts?: {
    isAppFocused?: boolean;
    currentUserId?: string | null;
  }): {
    showMessageNotification: ReturnType<typeof vi.fn>;
    dispatcher: PushDispatcher;
  } {
    const showMessageNotification = vi.fn();
    const dispatcher = new PushDispatcher();
    new ChatEventHandler({
      store: new ConversationStore(new MemKv()),
      dispatcher,
      engine: new FakeEngine() as never,
      onCreated: vi.fn(),
      notifier: { showMessageNotification },
      getCurrentUserId: () => opts?.currentUserId ?? 'u-me',
      isAppFocused: () => opts?.isAppFocused ?? false,
    });
    return { showMessageNotification, dispatcher };
  }

  function makeMsgFromOther(): ChatMessage {
    return {
      id: 'm-incoming',
      conversationId: 'c1',
      sender: { id: 'u-other', name: 'Alice', type: 'human' },
      contentType: 'text',
      content: { text: 'hello there' },
      timestamp: '2026-05-01T00:00:00Z',
      status: 'sent',
    };
  }

  it('fires notification for incoming message when app is unfocused', () => {
    const { showMessageNotification, dispatcher } = setup({ isAppFocused: false });
    dispatcher.dispatchServerMessage({ type: 'message.new', data: makeMsgFromOther() });
    expect(showMessageNotification).toHaveBeenCalledWith('Alice', 'hello there', 'c1');
  });

  it('suppresses notification when app is focused (user already sees it)', () => {
    const { showMessageNotification, dispatcher } = setup({ isAppFocused: true });
    dispatcher.dispatchServerMessage({ type: 'message.new', data: makeMsgFromOther() });
    expect(showMessageNotification).not.toHaveBeenCalled();
  });

  it('suppresses notification for messages from the current user', () => {
    const { showMessageNotification, dispatcher } = setup({ currentUserId: 'u-other' });
    dispatcher.dispatchServerMessage({ type: 'message.new', data: makeMsgFromOther() });
    expect(showMessageNotification).not.toHaveBeenCalled();
  });

  it('suppresses notification for non-human senders (agent / A2A traffic)', () => {
    const { showMessageNotification, dispatcher } = setup({ isAppFocused: false });
    const agentMsg: ChatMessage = {
      ...makeMsgFromOther(),
      sender: { id: 'a-default', name: 'Default', type: 'agent' },
    };
    dispatcher.dispatchServerMessage({ type: 'message.new', data: agentMsg });
    // Agent / system messages (A2A dialog traffic) are protocol noise —
    // they must not pop an OS notification.
    expect(showMessageNotification).not.toHaveBeenCalled();
  });

  it('uses content-type placeholders for non-text messages', () => {
    const { showMessageNotification, dispatcher } = setup();
    const m: ChatMessage = {
      ...makeMsgFromOther(),
      contentType: 'image',
      content: {} as never,
    };
    dispatcher.dispatchServerMessage({ type: 'message.new', data: m });
    expect(showMessageNotification).toHaveBeenCalledWith('Alice', '[image]', 'c1');
  });

  it('truncates long body to ~120 chars', () => {
    const { showMessageNotification, dispatcher } = setup();
    const long = 'a'.repeat(300);
    const m: ChatMessage = {
      ...makeMsgFromOther(),
      content: { text: long },
    };
    dispatcher.dispatchServerMessage({ type: 'message.new', data: m });
    const body = (showMessageNotification.mock.calls[0]?.[1] ?? '') as string;
    expect(body.length).toBeLessThanOrEqual(120);
    expect(body.endsWith('…')).toBe(true);
  });

  it('does nothing when notifier is omitted (legacy / tests)', () => {
    const dispatcher = new PushDispatcher();
    new ChatEventHandler({
      store: new ConversationStore(new MemKv()),
      dispatcher,
      engine: new FakeEngine() as never,
      onCreated: vi.fn(),
    });
    // No throw, no notifier call possible — purely a smoke test.
    dispatcher.dispatchServerMessage({ type: 'message.new', data: makeMsgFromOther() });
  });
});

describe('ChatEventHandler — dialog.intent_authorization push', () => {
  function setup(): {
    store: ConversationStore;
    dispatcher: PushDispatcher;
    onCreated: ReturnType<typeof vi.fn>;
  } {
    const store = new ConversationStore(new MemKv());
    const dispatcher = new PushDispatcher();
    const onCreated = vi.fn();
    new ChatEventHandler({
      store,
      dispatcher,
      engine: new FakeEngine() as never,
      onCreated,
    });
    return { store, dispatcher, onCreated };
  }

  it('synthesizes a system rich_card and upserts into the conversation', () => {
    const { store, dispatcher, onCreated } = setup();
    dispatcher.dispatchServerMessage({
      type: 'dialog.intent_authorization',
      data: {
        authorization_id: 'auth-xyz',
        agent_name: 'Default',
        conversation_id: 'c-agent',
        targets: [
          { target_user_name: 'Bob', contact_tag_display_name: 'team', topic: '想与你联系' },
        ],
      },
    });
    const msgs = store.listMessages('c-agent');
    expect(msgs.length).toBe(1);
    expect(msgs[0]?.id).toBe('intent-auth-auth-xyz');
    expect(msgs[0]?.contentType).toBe('rich_card');
    const content = msgs[0]?.content as Record<string, unknown>;
    expect(content.cardType).toBe('intent_authorization');
    expect(content.authorizationId).toBe('auth-xyz');
    expect(content.agentName).toBe('Default');
    expect(content.status).toBe('pending');
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it('preserves snake_case inside targets[] (renderer reads target_user_name etc.)', () => {
    const { store, dispatcher } = setup();
    dispatcher.dispatchServerMessage({
      type: 'dialog.intent_authorization',
      data: {
        authorization_id: 'auth-1',
        conversation_id: 'c1',
        targets: [{ target_user_name: 'Alice', topic: 'sync' }],
      },
    });
    const m = store.listMessages('c1')[0];
    const content = m?.content as { targets?: Array<Record<string, unknown>> };
    expect(content.targets?.[0]?.['target_user_name']).toBe('Alice');
    expect(content.targets?.[0]?.['topic']).toBe('sync');
  });

  it('is idempotent — duplicate push upserts the same id without spamming', () => {
    const { store, dispatcher } = setup();
    const data = {
      authorization_id: 'auth-dup',
      conversation_id: 'c1',
      targets: [],
    };
    dispatcher.dispatchServerMessage({ type: 'dialog.intent_authorization', data });
    dispatcher.dispatchServerMessage({ type: 'dialog.intent_authorization', data });
    expect(store.listMessages('c1').length).toBe(1);
  });

  it('drops invalid payloads without throwing', () => {
    const { store, dispatcher } = setup();
    // missing authorization_id
    dispatcher.dispatchServerMessage({
      type: 'dialog.intent_authorization',
      data: { conversation_id: 'c1', targets: [] },
    });
    expect(store.listMessages('c1').length).toBe(0);
  });

  it('carries is_main_agent flag through to the card content', () => {
    const { store, dispatcher } = setup();
    dispatcher.dispatchServerMessage({
      type: 'dialog.intent_authorization',
      data: {
        authorization_id: 'auth-main',
        conversation_id: 'c1',
        is_main_agent: true,
        targets: [],
      },
    });
    const content = store.listMessages('c1')[0]?.content as Record<string, unknown>;
    expect(content.isMainAgent).toBe(true);
  });
});

describe('ChatEventHandler — dialog.main_agent_blocked push', () => {
  function setup() {
    const store = new ConversationStore(new MemKv());
    const dispatcher = new PushDispatcher();
    const onCreated = vi.fn();
    new ChatEventHandler({
      store,
      dispatcher,
      engine: new FakeEngine() as never,
      onCreated,
    });
    return { store, dispatcher, onCreated };
  }

  it('synthesizes a text system message with the server-supplied text', () => {
    const { store, dispatcher } = setup();
    dispatcher.dispatchServerMessage({
      type: 'dialog.main_agent_blocked',
      data: { conversation_id: 'c1', message: '主代理不能这么干' },
    });
    const msgs = store.listMessages('c1');
    expect(msgs.length).toBe(1);
    expect(msgs[0]?.contentType).toBe('text');
    expect((msgs[0]?.content as { text?: string }).text).toBe('主代理不能这么干');
    expect(msgs[0]?.sender.type).toBe('system');
  });

  it('falls back to a default message when wire payload omits it', () => {
    const { store, dispatcher } = setup();
    dispatcher.dispatchServerMessage({
      type: 'dialog.main_agent_blocked',
      data: { conversation_id: 'c1' },
    });
    expect((store.listMessages('c1')[0]?.content as { text?: string }).text).toMatch(
      /Main Assistant/,
    );
  });

  it('drops invalid payload (missing conversation_id)', () => {
    const { store, dispatcher } = setup();
    dispatcher.dispatchServerMessage({
      type: 'dialog.main_agent_blocked',
      data: { message: 'no conv id' },
    });
    expect(store.listMessages('c1').length).toBe(0);
  });
});

describe('ChatEventHandler — audit.intent_denied push', () => {
  function setup() {
    const store = new ConversationStore(new MemKv());
    const dispatcher = new PushDispatcher();
    const onCreated = vi.fn();
    new ChatEventHandler({
      store,
      dispatcher,
      engine: new FakeEngine() as never,
      onCreated,
    });
    return { store, dispatcher, onCreated };
  }

  it('synthesizes a system message describing the deny reason', () => {
    const { store, dispatcher } = setup();
    dispatcher.dispatchServerMessage({
      type: 'audit.intent_denied',
      data: {
        conversation_id: 'c1',
        agent_name: 'Default',
        targets: ['bob'],
        reason: 'timeout',
      },
    });
    const msgs = store.listMessages('c1');
    expect(msgs.length).toBe(1);
    expect(msgs[0]?.contentType).toBe('text');
    const text = (msgs[0]?.content as { text?: string }).text ?? '';
    expect(text).toContain('Default');
    expect(text).toContain('bob');
    expect(text).toContain('timeout');
  });

  it('handles object-shaped targets entries', () => {
    const { store, dispatcher } = setup();
    dispatcher.dispatchServerMessage({
      type: 'audit.intent_denied',
      data: {
        conversation_id: 'c1',
        agent_name: 'Default',
        targets: [{ target_user_name: 'Alice' }, { target_user_name: 'Bob' }],
        reason: 'offline',
      },
    });
    const text = (store.listMessages('c1')[0]?.content as { text?: string }).text ?? '';
    expect(text).toContain('Alice, Bob');
  });

  it('drops when conversation_id is missing (no anchor for system msg)', () => {
    const { store, dispatcher } = setup();
    dispatcher.dispatchServerMessage({
      type: 'audit.intent_denied',
      data: { agent_name: 'Default', reason: 'timeout' },
    });
    expect(store.listMessages('c1').length).toBe(0);
  });
});
