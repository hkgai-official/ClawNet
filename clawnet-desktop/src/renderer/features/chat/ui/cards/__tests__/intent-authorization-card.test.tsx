// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IntentAuthorizationCard } from '../intent-authorization-card';
import type { ChatMessage } from '../../../../../../shared/domain/chat';
import { useIntentAuthTargetsStore } from '../../../../agents/state/intent-auth-targets-slice';

const ipcMock = vi.fn(async () => undefined);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts.defaultValue === 'string') {
        // Mimic i18next interpolation for {{var}} placeholders so tests
        // can assert on rendered text (e.g. "round 2/10").
        return (opts.defaultValue as string).replace(/\{\{(\w+)\}\}/g, (_, name) =>
          opts[name] === undefined ? '' : String(opts[name]),
        );
      }
      return k;
    },
  }),
}));

vi.mock('../../../../../hooks/use-ipc', () => ({
  useIpc: () => ipcMock,
}));

// Spy the toast store push so failure-path assertions are easy.
const toastPush = vi.fn();
vi.mock('../../../../../components/toast-overlay', () => ({
  toastStore: { getState: () => ({ push: toastPush }) },
}));

beforeEach(() => {
  cleanup();
  ipcMock.mockReset();
  ipcMock.mockResolvedValue(undefined);
  toastPush.mockClear();
  useIntentAuthTargetsStore.setState({
    byAuth: {},
    sessionToTarget: {},
    pendingApprovals: [],
    pendingStatusFrames: {},
  });
});

function makeMessage(content: Record<string, unknown>): ChatMessage {
  return {
    id: 'msg-1',
    conversationId: 'conv-1',
    sender: { id: 'a1', name: 'Agent X', type: 'agent' },
    contentType: 'rich_card',
    content,
    timestamp: '2025-01-01T00:00:00Z',
    status: 'sent',
  } as ChatMessage;
}

function renderWithQc(ui: React.ReactElement, qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return {
    qc,
    ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>),
  };
}

const baseContent = {
  cardType: 'intent_authorization' as const,
  authorizationId: 'auth-xyz',
  agentName: 'Helper',
  status: 'pending',
  targets: [{ target_user_name: 'Bob', topic: 'react help' }],
};

describe('IntentAuthorizationCard — normal flow', () => {
  it('renders Approve + Deny when pending', () => {
    renderWithQc(<IntentAuthorizationCard message={makeMessage(baseContent)} />);
    expect(screen.getByTestId('intent-approve-btn')).toBeTruthy();
    expect(screen.getByTestId('intent-deny-btn')).toBeTruthy();
  });

  it('hides both buttons when already approved', () => {
    renderWithQc(
      <IntentAuthorizationCard message={makeMessage({ ...baseContent, status: 'approved' })} />,
    );
    expect(screen.queryByTestId('intent-approve-btn')).toBeNull();
    expect(screen.queryByTestId('intent-deny-btn')).toBeNull();
  });

  it('clicking Approve fires IPC with authorizationId + approved:true', async () => {
    renderWithQc(<IntentAuthorizationCard message={makeMessage(baseContent)} />);
    fireEvent.click(screen.getByTestId('intent-approve-btn'));
    await waitFor(() =>
      expect(ipcMock).toHaveBeenCalledWith('dialogs.intentAuthorize', {
        authorizationId: 'auth-xyz',
        approved: true,
      }),
    );
  });

  it('clicking Deny fires IPC with approved:false', async () => {
    renderWithQc(<IntentAuthorizationCard message={makeMessage(baseContent)} />);
    fireEvent.click(screen.getByTestId('intent-deny-btn'));
    await waitFor(() =>
      expect(ipcMock).toHaveBeenCalledWith('dialogs.intentAuthorize', {
        authorizationId: 'auth-xyz',
        approved: false,
      }),
    );
  });

  it('optimistically patches message status in the React Query cache', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['chat.messages', 'conv-1'], {
      messages: [makeMessage(baseContent)],
      meta: null,
    });
    renderWithQc(<IntentAuthorizationCard message={makeMessage(baseContent)} />, qc);
    fireEvent.click(screen.getByTestId('intent-approve-btn'));
    await waitFor(() => {
      const cache = qc.getQueryData<{ messages: ChatMessage[] }>(['chat.messages', 'conv-1']);
      const content = cache?.messages[0]?.content as { status?: string } | undefined;
      expect(content?.status).toBe('approved');
    });
  });

  it('pushes an error toast when the IPC rejects', async () => {
    ipcMock.mockRejectedValueOnce(new Error('boom'));
    renderWithQc(<IntentAuthorizationCard message={makeMessage(baseContent)} />);
    fireEvent.click(screen.getByTestId('intent-approve-btn'));
    await waitFor(() => expect(toastPush).toHaveBeenCalled());
    const arg = toastPush.mock.calls[0]![0] as { message: string; level: string };
    expect(arg.level).toBe('error');
  });
});

describe('IntentAuthorizationCard — main-agent variant', () => {
  it('shows only the Understood button (no Approve)', () => {
    renderWithQc(
      <IntentAuthorizationCard
        message={makeMessage({ ...baseContent, isMainAgent: true })}
      />,
    );
    expect(screen.queryByTestId('intent-approve-btn')).toBeNull();
    const denyBtn = screen.getByTestId('intent-deny-btn');
    // The deny button uses the Understood label in the main-agent branch.
    expect(denyBtn.textContent).toBe('Understood');
  });

  it('clicking Understood fires IPC with approved:false', async () => {
    renderWithQc(
      <IntentAuthorizationCard
        message={makeMessage({ ...baseContent, isMainAgent: true })}
      />,
    );
    fireEvent.click(screen.getByTestId('intent-deny-btn'));
    await waitFor(() =>
      expect(ipcMock).toHaveBeenCalledWith('dialogs.intentAuthorize', {
        authorizationId: 'auth-xyz',
        approved: false,
      }),
    );
  });
});

describe('IntentAuthorizationCard — malformed payload', () => {
  it('renders fallback card when content fails to parse', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderWithQc(
      <IntentAuthorizationCard
        message={makeMessage({ invalid: 'shape' })}
      />,
    );
    // Fallback should render a normal-sized card with the "ended" message,
    // not the tiny red error placeholder, and keep the testid.
    expect(screen.getByTestId('intent-authorization-card')).toBeTruthy();
    expect(screen.getByText(/Authorization session ended/i)).toBeTruthy();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('renders fallback card (not tiny error placeholder) for partially-valid content', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderWithQc(
      <IntentAuthorizationCard
        message={makeMessage({ cardType: 'intent_authorization' })}
      />,
    );
    expect(screen.getByTestId('intent-authorization-card')).toBeTruthy();
    expect(screen.getByText(/Authorization session ended/i)).toBeTruthy();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('IntentAuthorizationCard — post-action result row', () => {
  it('renders PostActionResultRow with "approved" message when status === "approved"', () => {
    renderWithQc(
      <IntentAuthorizationCard
        message={makeMessage({
          cardType: 'intent_authorization',
          authorizationId: 'auth-X',
          agentName: 'Default',
          status: 'approved',
          isMainAgent: false,
          targets: [{ target_user_name: 'Bob', topic: 'hi' }],
        })}
      />,
    );
    expect(screen.getByText(/You authorized this request/i)).toBeTruthy();
    // Action buttons should NOT be present
    expect(screen.queryByTestId('intent-approve-btn')).toBeNull();
    expect(screen.queryByTestId('intent-deny-btn')).toBeNull();
  });

  it('renders PostActionResultRow with "denied" message when status === "denied"', () => {
    renderWithQc(
      <IntentAuthorizationCard
        message={makeMessage({
          cardType: 'intent_authorization',
          authorizationId: 'auth-Y',
          agentName: 'Default',
          status: 'denied',
          isMainAgent: false,
          targets: [{ target_user_name: 'Bob', topic: 'hi' }],
        })}
      />,
    );
    expect(screen.getByText(/You denied this request/i)).toBeTruthy();
  });
});

describe('IntentAuthorizationCard — agent name + status pill', () => {
  it('renders target_agent_name alongside target_user_name', () => {
    renderWithQc(
      <IntentAuthorizationCard
        message={makeMessage({
          ...baseContent,
          authorizationId: 'auth-A',
          targets: [
            { target_user_name: 'Bob', target_agent_name: 'friends（助理）', topic: 'hi' },
          ],
        })}
      />,
    );
    expect(screen.getByText(/Bob/)).toBeTruthy();
    expect(screen.getByText(/friends（助理）/)).toBeTruthy();
  });

  it('shows a status pill when slice has a runtime entry for this target', () => {
    useIntentAuthTargetsStore.setState({
      byAuth: {
        'auth-A': {
          'Bob__friends（助理）': { status: 'accepted', sessionId: 's1' },
        },
      },
      sessionToTarget: { s1: { authId: 'auth-A', targetKey: 'Bob__friends（助理）' } },
      pendingApprovals: [],
      pendingStatusFrames: {},
    });
    renderWithQc(
      <IntentAuthorizationCard
        message={makeMessage({
          ...baseContent,
          authorizationId: 'auth-A',
          targets: [
            { target_user_name: 'Bob', target_agent_name: 'friends（助理）', topic: 'hi' },
          ],
        })}
      />,
    );
    expect(screen.getByText(/Accepted/i)).toBeTruthy();
  });

  it('shows in-dialog round indicator when target is in_progress', () => {
    useIntentAuthTargetsStore.setState({
      byAuth: {
        'auth-B': {
          'Cynthia__tech': {
            status: 'in_progress',
            sessionId: 's2',
            currentRound: 2,
            maxRounds: 10,
          },
        },
      },
      sessionToTarget: { s2: { authId: 'auth-B', targetKey: 'Cynthia__tech' } },
      pendingApprovals: [],
      pendingStatusFrames: {},
    });
    renderWithQc(
      <IntentAuthorizationCard
        message={makeMessage({
          ...baseContent,
          authorizationId: 'auth-B',
          targets: [
            { target_user_name: 'Cynthia', target_agent_name: 'tech', topic: 'project' },
          ],
        })}
      />,
    );
    expect(screen.getByText(/In dialog/i)).toBeTruthy();
    expect(screen.getByText(/round 2\/10/i)).toBeTruthy();
  });
});

describe('IntentAuthorizationCard — status reflects user decision, not dialog outcome', () => {
  // PR #42 originally tried to derive the card's status from the
  // targets slice so a recipient rejection would flip the badge. That
  // conflated "user's authorization action" (which `status` records)
  // with "dialog outcome" (which `targets` records). macOS
  // `ChatEventHandler.swift:530-545` only mutates this field on local
  // click; we mirror that semantic. Rejection is surfaced via the
  // per-target pill + global toast instead.
  it('keeps "You authorized this request" even after a target turns rejected', () => {
    useIntentAuthTargetsStore.setState({
      byAuth: {
        'auth-R': {
          'Bob__': { status: 'rejected', sessionId: 's-rej' },
        },
      },
      sessionToTarget: { 's-rej': { authId: 'auth-R', targetKey: 'Bob__' } },
      pendingApprovals: [],
      pendingStatusFrames: {},
    });
    renderWithQc(
      <IntentAuthorizationCard
        message={makeMessage({
          ...baseContent,
          authorizationId: 'auth-R',
          status: 'approved',
          targets: [{ target_user_name: 'Bob', topic: 'hi' }],
        })}
      />,
    );
    expect(screen.getByText(/You authorized this request/i)).toBeTruthy();
    expect(screen.queryByText(/You denied this request/i)).toBeNull();
  });
});
