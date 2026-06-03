// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useIntentAuthTargetsStore } from '../intent-auth-targets-slice';

const T0 = new Date('2026-05-21T10:00:00').getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(T0));
  useIntentAuthTargetsStore.setState(useIntentAuthTargetsStore.getState(), true);  // reset
  useIntentAuthTargetsStore.setState({
    byAuth: {},
    sessionToTarget: {},
    pendingApprovals: [],
    pendingStatusFrames: {},
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function initOneAuth() {
  useIntentAuthTargetsStore.getState().initFromIntentAuth({
    authorizationId: 'auth-1',
    targets: [
      { userName: 'Bob', agentName: 'friends（助理）', topic: 'topicA' },
      { userName: 'Cynthia', agentName: 'tech', topic: 'topicB' },
    ],
  });
}

describe('intent-auth-targets slice', () => {
  it('initFromIntentAuth seeds idle entries', () => {
    initOneAuth();
    const s = useIntentAuthTargetsStore.getState();
    expect(s.byAuth['auth-1']?.['Bob__friends（助理）']?.status).toBe('idle');
    expect(s.byAuth['auth-1']?.['Cynthia__tech']?.status).toBe('idle');
  });

  it('markSubmitted flips all targets and appends to pendingApprovals', () => {
    initOneAuth();
    useIntentAuthTargetsStore.getState().markSubmitted('auth-1');
    const s = useIntentAuthTargetsStore.getState();
    expect(s.byAuth['auth-1']?.['Bob__friends（助理）']?.status).toBe('submitted');
    expect(s.byAuth['auth-1']?.['Cynthia__tech']?.status).toBe('submitted');
    expect(s.pendingApprovals).toHaveLength(1);
    expect(s.pendingApprovals[0]?.authId).toBe('auth-1');
    expect(s.pendingApprovals[0]?.pressedAt).toBe(T0);
  });

  it('applyRequestSent matches by topic in the fresh pending window', () => {
    initOneAuth();
    useIntentAuthTargetsStore.getState().markSubmitted('auth-1');
    useIntentAuthTargetsStore.getState().applyRequestSent({
      sessionId: 'sess-A',
      conversationId: 'conv-1',
      topic: 'topicA',
      responderOwner: { displayName: 'Bob' },
      responderAgent: { displayName: 'friends（助理）' },
    });
    const s = useIntentAuthTargetsStore.getState();
    expect(s.byAuth['auth-1']?.['Bob__friends（助理）']?.status).toBe('pending');
    expect(s.byAuth['auth-1']?.['Bob__friends（助理）']?.sessionId).toBe('sess-A');
    expect(s.sessionToTarget['sess-A']).toEqual({ authId: 'auth-1', targetKey: 'Bob__friends（助理）' });
    // Other target untouched
    expect(s.byAuth['auth-1']?.['Cynthia__tech']?.status).toBe('submitted');
  });

  it('applyRequestSent falls back to responder-identity when topic does not match', () => {
    initOneAuth();
    useIntentAuthTargetsStore.getState().markSubmitted('auth-1');
    useIntentAuthTargetsStore.getState().applyRequestSent({
      sessionId: 'sess-B',
      conversationId: 'conv-1',
      topic: 'no-such-topic',
      responderOwner: { displayName: 'Cynthia' },
      responderAgent: { displayName: 'tech' },
    });
    expect(useIntentAuthTargetsStore.getState().byAuth['auth-1']?.['Cynthia__tech']?.status).toBe('pending');
  });

  it('applyStatusChanged active → accepted, completed → completed, rejected → rejected, terminated → rejected', () => {
    initOneAuth();
    useIntentAuthTargetsStore.getState().markSubmitted('auth-1');
    useIntentAuthTargetsStore.getState().applyRequestSent({
      sessionId: 'sess-A', conversationId: 'c', topic: 'topicA',
      responderOwner: { displayName: 'Bob' }, responderAgent: { displayName: 'friends（助理）' },
    });
    useIntentAuthTargetsStore.getState().applyStatusChanged({ sessionId: 'sess-A', status: 'active' });
    expect(useIntentAuthTargetsStore.getState().byAuth['auth-1']?.['Bob__friends（助理）']?.status).toBe('accepted');
    useIntentAuthTargetsStore.getState().applyStatusChanged({ sessionId: 'sess-A', status: 'completed' });
    expect(useIntentAuthTargetsStore.getState().byAuth['auth-1']?.['Bob__friends（助理）']?.status).toBe('completed');
    useIntentAuthTargetsStore.getState().applyStatusChanged({ sessionId: 'sess-A', status: 'rejected' });
    expect(useIntentAuthTargetsStore.getState().byAuth['auth-1']?.['Bob__friends（助理）']?.status).toBe('rejected');
    useIntentAuthTargetsStore.getState().applyStatusChanged({ sessionId: 'sess-A', status: 'terminated' });
    expect(useIntentAuthTargetsStore.getState().byAuth['auth-1']?.['Bob__friends（助理）']?.status).toBe('rejected');
  });

  it('applyStatusChanged with round info flips to in_progress (when not terminal) and updates rounds', () => {
    initOneAuth();
    useIntentAuthTargetsStore.getState().markSubmitted('auth-1');
    useIntentAuthTargetsStore.getState().applyRequestSent({
      sessionId: 'sess-A', conversationId: 'c', topic: 'topicA',
      responderOwner: { displayName: 'Bob' }, responderAgent: { displayName: 'friends（助理）' },
    });
    useIntentAuthTargetsStore.getState().applyStatusChanged({ sessionId: 'sess-A', status: 'active' });
    useIntentAuthTargetsStore.getState().applyStatusChanged({ sessionId: 'sess-A', currentRound: 2, maxRounds: 10 });
    const t = useIntentAuthTargetsStore.getState().byAuth['auth-1']?.['Bob__friends（助理）'];
    expect(t?.status).toBe('in_progress');
    expect(t?.currentRound).toBe(2);
    expect(t?.maxRounds).toBe(10);
  });

  it('applyStatusChanged before applyRequestSent buffers and replays on bind', () => {
    initOneAuth();
    useIntentAuthTargetsStore.getState().markSubmitted('auth-1');
    // Status arrives FIRST (out of order)
    useIntentAuthTargetsStore.getState().applyStatusChanged({ sessionId: 'sess-A', status: 'active' });
    // Then the bind frame
    useIntentAuthTargetsStore.getState().applyRequestSent({
      sessionId: 'sess-A', conversationId: 'c', topic: 'topicA',
      responderOwner: { displayName: 'Bob' }, responderAgent: { displayName: 'friends（助理）' },
    });
    const t = useIntentAuthTargetsStore.getState().byAuth['auth-1']?.['Bob__friends（助理）'];
    expect(t?.status).toBe('accepted');  // status frame was drained on bind
    expect(t?.sessionId).toBe('sess-A');
  });

  it('markSubmitted prunes stale pendingApprovals beyond the window', () => {
    initOneAuth();
    useIntentAuthTargetsStore.getState().markSubmitted('auth-1');
    vi.setSystemTime(new Date(T0 + 31_000));  // 31s later
    // Init + submit a fresh auth.
    useIntentAuthTargetsStore.getState().initFromIntentAuth({
      authorizationId: 'auth-2',
      targets: [{ userName: 'Kevin', agentName: 'friends', topic: 'topicC' }],
    });
    useIntentAuthTargetsStore.getState().markSubmitted('auth-2');
    // Stale entry pruned; only the fresh one remains.
    const s = useIntentAuthTargetsStore.getState();
    expect(s.pendingApprovals).toHaveLength(1);
    expect(s.pendingApprovals[0]?.authId).toBe('auth-2');
  });

  it('pendingApprovals entries beyond 30s do not match new request_sent frames', () => {
    initOneAuth();
    useIntentAuthTargetsStore.getState().markSubmitted('auth-1');
    vi.setSystemTime(new Date(T0 + 31_000));  // 31s later — window expired
    useIntentAuthTargetsStore.getState().applyRequestSent({
      sessionId: 'sess-X', conversationId: 'c', topic: 'topicA',
      responderOwner: { displayName: 'Someone' }, responderAgent: { displayName: 'Else' },
    });
    // No matching pending-window entry, no responder match — frame should drop.
    expect(useIntentAuthTargetsStore.getState().sessionToTarget['sess-X']).toBeUndefined();
    expect(useIntentAuthTargetsStore.getState().byAuth['auth-1']?.['Bob__friends（助理）']?.status).toBe('submitted');
  });
});
