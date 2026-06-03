import { create } from 'zustand';

export type TargetStatus =
  | 'idle'
  | 'submitted'
  | 'pending'
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'rejected';

export interface TargetRuntime {
  status: TargetStatus;
  sessionId?: string;
  topic?: string;
  currentRound?: number;
  maxRounds?: number;
}

type TargetKey = string;  // `${target_user_name}__${target_agent_name}`

const PENDING_WINDOW_MS = 30_000;

interface PendingApproval {
  authId: string;
  expectedTopics: Array<{ topic?: string; key: TargetKey }>;
  pressedAt: number;
}

interface StatusFrame {
  status?: string;
  currentRound?: number;
  maxRounds?: number;
}

export interface IntentAuthTargetsState {
  byAuth: Record<string, Record<TargetKey, TargetRuntime>>;
  sessionToTarget: Record<string, { authId: string; targetKey: TargetKey }>;
  pendingApprovals: PendingApproval[];
  pendingStatusFrames: Record<string /* sessionId */, StatusFrame[]>;

  initFromIntentAuth: (input: {
    authorizationId: string;
    targets: Array<{ userName: string; agentName?: string; topic?: string }>;
  }) => void;
  markSubmitted: (authorizationId: string) => void;
  applyRequestSent: (frame: {
    sessionId: string;
    conversationId: string;
    topic?: string;
    responderOwner?: { id?: string; displayName?: string };
    responderAgent?: { id?: string; displayName?: string };
  }) => void;
  applyStatusChanged: (frame: {
    sessionId: string;
    status?: string;
    currentRound?: number;
    maxRounds?: number;
  }) => void;
}

const TERMINAL = new Set<TargetStatus>(['completed', 'rejected']);

function targetKey(userName: string, agentName?: string): TargetKey {
  return `${userName}__${agentName ?? ''}`;
}

function statusFromWire(s: string | undefined, current: TargetStatus): TargetStatus {
  switch (s) {
    case 'active':                return 'accepted';
    case 'pending_approval':      return 'pending';
    case 'completed':             return 'completed';
    case 'rejected':              return 'rejected';
    case 'terminated':            return 'rejected';
    default:                      return current;
  }
}

/**
 * Apply a status frame to the slice state, returning a partial state.
 * Returns the original state if the session is not yet bound or target missing.
 * Shared by the public `applyStatusChanged` action and the drain logic in `bindSession`.
 */
function applyStatusChangedInternal(
  s: IntentAuthTargetsState,
  sessionId: string,
  frame: StatusFrame,
): Partial<IntentAuthTargetsState> | null {
  const ref = s.sessionToTarget[sessionId];
  if (!ref) return null;
  const entry = s.byAuth[ref.authId];
  const cur = entry?.[ref.targetKey];
  if (!entry || !cur) return null;

  // 1. Apply explicit status if present.
  let nextStatus: TargetStatus = statusFromWire(frame.status, cur.status);

  // 2. If round info present and we're not terminal, flip to in_progress.
  const hasRoundInfo =
    typeof frame.currentRound === 'number' || typeof frame.maxRounds === 'number';
  if (hasRoundInfo && !TERMINAL.has(nextStatus)) {
    nextStatus = 'in_progress';
  }

  const updated: TargetRuntime = { ...cur, status: nextStatus };
  const nextCurrentRound = frame.currentRound ?? cur.currentRound;
  if (nextCurrentRound !== undefined) updated.currentRound = nextCurrentRound;
  const nextMaxRounds = frame.maxRounds ?? cur.maxRounds;
  if (nextMaxRounds !== undefined) updated.maxRounds = nextMaxRounds;
  return {
    byAuth: {
      ...s.byAuth,
      [ref.authId]: { ...entry, [ref.targetKey]: updated },
    },
  };
}

export const useIntentAuthTargetsStore = create<IntentAuthTargetsState>((set, get) => ({
  byAuth: {},
  sessionToTarget: {},
  pendingApprovals: [],
  pendingStatusFrames: {},

  initFromIntentAuth: ({ authorizationId, targets }) => {
    set((s) => {
      // If already initialized, don't clobber existing runtime — IntentAuth
      // cards may re-mount during list scrolls; treat as idempotent.
      if (s.byAuth[authorizationId]) return s;
      const entry: Record<TargetKey, TargetRuntime> = {};
      for (const t of targets) {
        const tr: TargetRuntime = { status: 'idle' };
        if (t.topic !== undefined) tr.topic = t.topic;
        entry[targetKey(t.userName, t.agentName)] = tr;
      }
      return { byAuth: { ...s.byAuth, [authorizationId]: entry } };
    });
  },

  markSubmitted: (authorizationId) => {
    set((s) => {
      const entry = s.byAuth[authorizationId];
      if (!entry) return s;
      const next: Record<TargetKey, TargetRuntime> = {};
      const expectedTopics: PendingApproval['expectedTopics'] = [];
      for (const [k, v] of Object.entries(entry)) {
        next[k] = { ...v, status: 'submitted' };
        const et: { topic?: string; key: TargetKey } = { key: k };
        if (v.topic !== undefined) et.topic = v.topic;
        expectedTopics.push(et);
      }
      const now = Date.now();
      const pending: PendingApproval = {
        authId: authorizationId,
        expectedTopics,
        pressedAt: now,
      };
      // Prune entries past the window so the array stays bounded.
      const fresh = s.pendingApprovals.filter(p => now - p.pressedAt < PENDING_WINDOW_MS);
      return {
        byAuth: { ...s.byAuth, [authorizationId]: next },
        pendingApprovals: [...fresh, pending],
      };
    });
  },

  applyRequestSent: (frame) => {
    const now = Date.now();
    const s = get();

    // Step 1: topic match within fresh pending window.
    for (const pa of s.pendingApprovals) {
      if (now - pa.pressedAt >= PENDING_WINDOW_MS) continue;
      for (const et of pa.expectedTopics) {
        if (et.topic && et.topic === frame.topic) {
          const target = s.byAuth[pa.authId]?.[et.key];
          if (target?.status === 'submitted') {
            bindSession(set, get, pa.authId, et.key, frame.sessionId);
            return;
          }
        }
      }
    }

    // Step 2: responder-identity fallback across all auths.
    const userName = frame.responderOwner?.displayName;
    const agentName = frame.responderAgent?.displayName;
    if (userName) {
      const k = targetKey(userName, agentName);
      for (const [authId, entries] of Object.entries(s.byAuth)) {
        if (entries[k]?.status === 'submitted') {
          bindSession(set, get, authId, k, frame.sessionId);
          return;
        }
      }
    }

    // No match — drop silently. (Debug-log if useful; left out to keep YAGNI.)
  },

  applyStatusChanged: (frame) => {
    set((s) => {
      const ref = s.sessionToTarget[frame.sessionId];
      if (!ref) {
        // Session not yet bound — buffer the frame for replay on bind.
        const existing = s.pendingStatusFrames[frame.sessionId] ?? [];
        const buffered: StatusFrame = {};
        if (frame.status !== undefined) buffered.status = frame.status;
        if (frame.currentRound !== undefined) buffered.currentRound = frame.currentRound;
        if (frame.maxRounds !== undefined) buffered.maxRounds = frame.maxRounds;
        return {
          pendingStatusFrames: {
            ...s.pendingStatusFrames,
            [frame.sessionId]: [...existing, buffered],
          },
        };
      }
      const patch = applyStatusChangedInternal(s, frame.sessionId, frame);
      return patch ?? s;
    });
  },
}));

type SetState = (
  partial:
    | IntentAuthTargetsState
    | Partial<IntentAuthTargetsState>
    | ((state: IntentAuthTargetsState) => IntentAuthTargetsState | Partial<IntentAuthTargetsState>),
  replace?: false,
) => void;

type GetState = () => IntentAuthTargetsState;

function bindSession(
  set: SetState,
  get: GetState,
  authId: string,
  key: TargetKey,
  sessionId: string,
) {
  set((s) => {
    const entry = s.byAuth[authId];
    if (!entry) return s;
    const cur = entry[key];
    if (!cur) return s;
    return {
      byAuth: {
        ...s.byAuth,
        [authId]: { ...entry, [key]: { ...cur, status: 'pending', sessionId } },
      },
      sessionToTarget: {
        ...s.sessionToTarget,
        [sessionId]: { authId, targetKey: key },
      },
    };
  });

  // Drain any status frames that arrived before the bind.
  const post = get();
  const buffered = post.pendingStatusFrames[sessionId];
  if (!buffered || buffered.length === 0) return;
  set((s) => {
    let acc: IntentAuthTargetsState = s;
    for (const frame of buffered) {
      const patch = applyStatusChangedInternal(acc, sessionId, frame);
      if (patch) acc = { ...acc, ...patch };
    }
    const { [sessionId]: _drained, ...restPending } = acc.pendingStatusFrames;
    return {
      byAuth: acc.byAuth,
      pendingStatusFrames: restPending,
    };
  });
}
