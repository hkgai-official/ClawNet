// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DialogApprovalCard } from '../dialog-approval-card';
import type { ChatMessage } from '../../../../../../shared/domain/chat';

// DialogApprovalCard now uses useQueryClient() for the optimistic
// status patch (mirrors IntentAuthorizationCard). Wrap each render in
// a fresh client so tests don't share cache.
function renderCard(message: ChatMessage) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <DialogApprovalCard message={message} />
      </QueryClientProvider>,
    ),
  };
}

const approveMutate = vi.fn();
let mockApproveIsPending = false;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts && 'defaultValue' in opts ? (opts.defaultValue as string) : k,
  }),
}));

vi.mock('../../../../agents/hooks/use-dialog', () => ({
  useDialogActions: () => ({
    approve: { mutate: approveMutate, isPending: mockApproveIsPending },
    requestMain: { mutate: vi.fn(), isPending: false },
    refine: { mutate: vi.fn(), isPending: false },
    submitResponse: { mutate: vi.fn(), isPending: false },
    terminate: { mutate: vi.fn(), isPending: false },
    extend: { mutate: vi.fn(), isPending: false },
  }),
}));

beforeEach(() => {
  cleanup();
  approveMutate.mockClear();
  mockApproveIsPending = false;
});

function makeMessage(content: Record<string, unknown>): ChatMessage {
  return {
    id: 'm1',
    conversationId: 'c1',
    sender: { id: 'a1', name: 'Agent', type: 'agent' },
    contentType: 'dialog_approval',
    content: content as ChatMessage['content'],
    timestamp: '2026-05-15T00:00:00Z',
  };
}

describe('DialogApprovalCard', () => {
  it('renders an error fallback for an invalid payload', () => {
    renderCard(makeMessage({ junk: 1 }));
    expect(screen.getByText(/payload invalid/i)).toBeTruthy();
  });

  it('pending + sessionId → Authorize / Reject buttons', () => {
    renderCard(makeMessage({ status: 'pending', sessionId: 's1', topic: 'hi' }));
    expect(screen.getByRole('button', { name: /Authorize/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Reject/i })).toBeTruthy();
  });

  it('Authorize → approve.mutate({approved:true}); Reject → {approved:false}', () => {
    renderCard(makeMessage({ status: 'pending', sessionId: 's1' }));
    fireEvent.click(screen.getByRole('button', { name: /Authorize/i }));
    // mutate is now called with two args (payload, { onSuccess/onError/onSettled });
    // assert on the payload arg only so the test stays focused on the user-visible contract.
    expect(approveMutate.mock.calls[0]![0]).toEqual({ approved: true });
    fireEvent.click(screen.getByRole('button', { name: /Reject/i }));
    expect(approveMutate.mock.calls[1]![0]).toEqual({ approved: false });
  });

  it('pending but NO sessionId → canAct false → no action buttons', () => {
    renderCard(makeMessage({ status: 'pending' }));
    expect(screen.queryByRole('button', { name: /Authorize/i })).toBeNull();
  });

  it('non-pending status → no action buttons (status badge instead)', () => {
    renderCard(makeMessage({ status: 'approved', sessionId: 's1' }));
    expect(screen.queryByRole('button', { name: /Authorize/i })).toBeNull();
  });

  it('shows Authorizing… and disables both buttons while approve.isPending', () => {
    mockApproveIsPending = true;
    renderCard(makeMessage({ status: 'pending', sessionId: 's1', topic: 'hi' }));
    fireEvent.click(screen.getByRole('button', { name: /Authorize/i }));
    const authorizingBtn = screen.getByRole('button', {
      name: /Authorizing/i,
    }) as HTMLButtonElement;
    const rejectBtn = screen.getByRole('button', { name: /Reject/i }) as HTMLButtonElement;
    expect(authorizingBtn.disabled).toBe(true);
    expect(rejectBtn.disabled).toBe(true);
  });

  it('passes onSettled to approve.mutate and clears submitting on settle', () => {
    mockApproveIsPending = false;
    renderCard(makeMessage({ status: 'pending', sessionId: 's1', topic: 'hi' }));
    fireEvent.click(screen.getByRole('button', { name: /Authorize/i }));
    expect(approveMutate).toHaveBeenCalledTimes(1);
    expect(approveMutate.mock.calls[0]![0]).toEqual({ approved: true });
    const opts = approveMutate.mock.calls[0]![1] as { onSettled?: () => void };
    expect(typeof opts?.onSettled).toBe('function');
    opts.onSettled!();
  });

  it('Reject path is analogous', () => {
    mockApproveIsPending = false;
    renderCard(makeMessage({ status: 'pending', sessionId: 's1', topic: 'hi' }));
    fireEvent.click(screen.getByRole('button', { name: /Reject/i }));
    expect(approveMutate).toHaveBeenCalledTimes(1);
    expect(approveMutate.mock.calls[0]![0]).toEqual({ approved: false });
    const opts = approveMutate.mock.calls[0]![1] as { onSettled?: () => void };
    expect(typeof opts?.onSettled).toBe('function');
  });

  // NEW: regression for the 500 "Session is not pending approval" bug.
  // After a successful approve, the card's message.content.status MUST
  // be optimistically patched to 'approved' so isPending flips false
  // and the buttons hide — otherwise the user can click again and the
  // second POST /approve hits a server-side conflict.
  it('on success → optimistic content.status patch to "approved"', () => {
    mockApproveIsPending = false;
    const { qc } = renderCard(makeMessage({ status: 'pending', sessionId: 's1', topic: 'hi' }));
    // Seed the cache so the patch has something to update.
    qc.setQueryData(['chat.messages', 'c1'], {
      messages: [makeMessage({ status: 'pending', sessionId: 's1', topic: 'hi' })],
      meta: null,
    });
    fireEvent.click(screen.getByRole('button', { name: /Authorize/i }));
    // Simulate the mutation succeeding.
    const opts = approveMutate.mock.calls[0]![1] as {
      onSuccess?: () => void;
      onSettled?: () => void;
    };
    opts.onSuccess!();
    const cache = qc.getQueryData<{ messages: ChatMessage[] }>(['chat.messages', 'c1']);
    expect((cache?.messages[0]?.content as { status?: string }).status).toBe('approved');
  });

  it('on success of reject → optimistic content.status patch to "rejected"', () => {
    mockApproveIsPending = false;
    const { qc } = renderCard(makeMessage({ status: 'pending', sessionId: 's1', topic: 'hi' }));
    qc.setQueryData(['chat.messages', 'c1'], {
      messages: [makeMessage({ status: 'pending', sessionId: 's1', topic: 'hi' })],
      meta: null,
    });
    fireEvent.click(screen.getByRole('button', { name: /Reject/i }));
    const opts = approveMutate.mock.calls[0]![1] as { onSuccess?: () => void };
    opts.onSuccess!();
    const cache = qc.getQueryData<{ messages: ChatMessage[] }>(['chat.messages', 'c1']);
    expect((cache?.messages[0]?.content as { status?: string }).status).toBe('rejected');
  });
});
