// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { A2AReviewSurface } from '../a2a-review-surface';
import type { DialogSession } from '../../../../../shared/domain/dialog';
import type { DraftState } from '../../state/dialog-draft-slice';

// submitResponse.mutate invokes its onSuccess callback so tests can
// observe the post-submit reset (mirrors react-query on a 2xx).
const submitResponseMutate = vi.fn(
  (_vars: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.(),
);
const requestMainMutate = vi.fn();
const refineMutate = vi.fn();
const extendMutate = vi.fn();
const terminateMutate = vi.fn();
const clearDraftMock = vi.fn();

let sessionData: DialogSession | null = null;
let draftData: DraftState | undefined;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts === 'object' && 'defaultValue' in opts) {
        let out = opts.defaultValue as string;
        for (const [key, val] of Object.entries(opts)) {
          if (key === 'defaultValue') continue;
          out = out.replace(`{{${key}}}`, String(val)).replace(`${val}`, String(val));
        }
        return out;
      }
      return k;
    },
  }),
}));

vi.mock('../../hooks/use-dialog', () => ({
  useDialogByConversation: () => ({ data: sessionData }),
  useDialogActions: () => ({
    approve: { mutate: vi.fn(), isPending: false },
    requestMain: { mutate: requestMainMutate, isPending: false },
    refine: { mutate: refineMutate, isPending: false },
    submitResponse: { mutate: submitResponseMutate, isPending: false },
    terminate: { mutate: terminateMutate, isPending: false },
    extend: { mutate: extendMutate, isPending: false },
  }),
}));

vi.mock('../../hooks/use-dialog-draft', () => ({
  useDialogDraft: () => draftData,
}));

vi.mock('../../state/dialog-draft-slice', () => ({
  useDialogDraftStore: (selector: (s: { clearDraft: typeof clearDraftMock }) => unknown) =>
    selector({ clearDraft: clearDraftMock }),
}));

vi.mock('../../../../components/markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}));

beforeEach(() => {
  cleanup();
  submitResponseMutate.mockClear();
  requestMainMutate.mockClear();
  refineMutate.mockClear();
  extendMutate.mockClear();
  terminateMutate.mockClear();
  clearDraftMock.mockClear();
  sessionData = null;
  draftData = undefined;
});

function makeSession(overrides: Partial<DialogSession> = {}): DialogSession {
  return {
    id: 's1',
    initiatorAgent: { id: 'a-alice', displayName: 'Default' },
    responderAgent: { id: 'a-bob', displayName: 'Bob Agent' },
    initiatorOwner: { id: 'u-alice', displayName: 'Alice' },
    responderOwner: { id: 'u-bob', displayName: 'Bob' },
    topic: 'contact Bob',
    status: 'active',
    currentRound: 0,
    maxRounds: 5,
    createdAt: '2026-05-15T00:00:00Z',
    ...overrides,
  };
}

describe('A2AReviewSurface — render gating', () => {
  it('renders nothing when there is no dialog session', () => {
    sessionData = null;
    const { container } = render(<A2AReviewSurface conversationId="c1" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a completed row for a completed session (not null)', () => {
    sessionData = makeSession({ status: 'completed' });
    render(<A2AReviewSurface conversationId="c1" />);
    expect(screen.getByText(/Dialog completed/i)).toBeTruthy();
  });
});

describe('A2AReviewSurface — compact mode (active, no draft)', () => {
  it('shows the status row with topic + round counter + Extend/Terminate, no draft block', () => {
    sessionData = makeSession({ currentRound: 0, maxRounds: 5 });
    draftData = undefined;
    render(<A2AReviewSurface conversationId="c1" />);
    expect(screen.getByText('contact Bob')).toBeTruthy();
    // round display = floor((0+1)/2) / floor((5+1)/2) = 0/3
    expect(screen.getByText('0/3')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Extend/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Terminate/i })).toBeTruthy();
    // No source switcher in compact mode.
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('Extend → reveals rounds input → Confirm calls extend mutation', () => {
    sessionData = makeSession();
    render(<A2AReviewSurface conversationId="c1" />);
    fireEvent.click(screen.getByRole('button', { name: /Extend/i }));
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /^Confirm$/i }));
    expect(extendMutate).toHaveBeenCalled();
    expect(extendMutate.mock.calls[0]![0]).toMatchObject({ additionalRounds: 3 });
  });

  it('Terminate → confirm → calls terminate with owner_terminated', () => {
    sessionData = makeSession();
    render(<A2AReviewSurface conversationId="c1" />);
    fireEvent.click(screen.getByRole('button', { name: /Terminate/i }));
    fireEvent.click(screen.getByRole('button', { name: /End dialog/i }));
    expect(terminateMutate).toHaveBeenCalledWith({ reason: 'owner_terminated' });
  });
});

describe('A2AReviewSurface — review mode (draft present)', () => {
  it('shows the 3-way source switcher + tag draft + send button', () => {
    sessionData = makeSession();
    draftData = { secondaryDraftText: 'Hello from Bob agent', status: 'ready' };
    render(<A2AReviewSurface conversationId="c1" />);
    expect(screen.getByRole('tablist')).toBeTruthy();
    // Default selected source = tag → draft area testid is a2a-draft-tag.
    expect(screen.getByTestId('a2a-draft-tag')).toBeTruthy();
    expect(screen.getByText('Hello from Bob agent')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Send via/i })).toBeTruthy();
  });

  it('switching to the manual tab swaps the draft area to an editable textarea', () => {
    sessionData = makeSession();
    draftData = { secondaryDraftText: 'tag draft', status: 'ready' };
    render(<A2AReviewSurface conversationId="c1" />);
    fireEvent.click(screen.getByRole('tab', { name: 'You' }));
    const manualBox = screen.getByTestId('a2a-draft-manual');
    const textarea = manualBox.querySelector('textarea')!;
    expect(textarea).toBeTruthy();
    fireEvent.change(textarea, { target: { value: 'I will reply myself' } });
    fireEvent.click(screen.getByRole('button', { name: /Send manual reply/i }));
    expect(submitResponseMutate.mock.calls[0]![0]).toEqual({ text: 'I will reply myself' });
  });

  it('clicking the Main Assistant tab lazy-requests the main draft', () => {
    sessionData = makeSession();
    draftData = { secondaryDraftText: 'tag draft', status: 'ready' };
    render(<A2AReviewSurface conversationId="c1" />);
    fireEvent.click(screen.getByRole('tab', { name: /Main Assistant/i }));
    expect(requestMainMutate).toHaveBeenCalledTimes(1);
    // Draft area is now keyed to main.
    expect(screen.getByTestId('a2a-draft-main')).toBeTruthy();
  });

  it('Send button submits the tag draft text', () => {
    sessionData = makeSession();
    draftData = { secondaryDraftText: 'the tag draft body', status: 'ready' };
    render(<A2AReviewSurface conversationId="c1" />);
    fireEvent.click(screen.getByRole('button', { name: /Send via/i }));
    expect(submitResponseMutate.mock.calls[0]![0]).toEqual({ text: 'the tag draft body' });
  });

  it('after a successful manual submit the input is cleared + draft consumed', () => {
    sessionData = makeSession();
    draftData = { secondaryDraftText: 'tag draft', status: 'ready' };
    render(<A2AReviewSurface conversationId="c1" />);

    fireEvent.click(screen.getByRole('tab', { name: 'You' }));
    const textarea = screen.getByTestId('a2a-draft-manual').querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'my typed reply' } });
    fireEvent.click(screen.getByRole('button', { name: /Send manual reply/i }));

    // Draft is consumed (→ compact for the next round) and the source
    // resets to tag, so the draft area is keyed back to tag.
    expect(clearDraftMock).toHaveBeenCalledWith('s1');
    expect(screen.queryByTestId('a2a-draft-manual')).toBeNull();
    expect(screen.getByTestId('a2a-draft-tag')).toBeTruthy();

    // Re-opening the manual tab shows an empty textarea — the typed
    // text did not survive the submit.
    fireEvent.click(screen.getByRole('tab', { name: 'You' }));
    const reopened = screen.getByTestId('a2a-draft-manual').querySelector('textarea')!;
    expect(reopened.value).toBe('');
  });

  it('refine instruction on the tag draft calls refine with target=tag', () => {
    sessionData = makeSession();
    draftData = { secondaryDraftText: 'tag draft', status: 'ready' };
    render(<A2AReviewSurface conversationId="c1" />);
    const refineInput = screen.getByPlaceholderText(/Refine instruction/i);
    fireEvent.change(refineInput, { target: { value: 'make it friendlier' } });
    fireEvent.click(screen.getByRole('button', { name: /^Refine$/i }));
    expect(refineMutate.mock.calls[0]![0]).toMatchObject({
      target: 'tag',
      instruction: 'make it friendlier',
    });
  });
});

describe('status branches', () => {
  it('renders terminated row when session.status === "terminated"', () => {
    sessionData = makeSession({ status: 'terminated' });
    render(<A2AReviewSurface conversationId="conv-1" />);
    expect(screen.getByText(/Dialog terminated/i)).toBeTruthy();
    expect(screen.queryByText(/remote_rejected/i)).toBeNull();
  });

  it('shows the terminationReason inline when present (e.g. responder rejected)', () => {
    sessionData = makeSession({ status: 'terminated', terminationReason: 'remote_rejected' });
    render(<A2AReviewSurface conversationId="conv-1" />);
    expect(screen.getByText(/Dialog terminated/i)).toBeTruthy();
    expect(screen.getByText(/remote_rejected/i)).toBeTruthy();
  });

  it('renders completed row when session.status === "completed"', () => {
    sessionData = makeSession({ status: 'completed' });
    render(<A2AReviewSurface conversationId="conv-1" />);
    expect(screen.getByText(/Dialog completed/i)).toBeTruthy();
  });

  it.each(['pending_approval', 'paused'] as const)(
    'renders nothing for status %s',
    (status) => {
      sessionData = makeSession({ status });
      const { container } = render(<A2AReviewSurface conversationId="conv-1" />);
      expect(container.firstChild).toBeNull();
    },
  );
});
