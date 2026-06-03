// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { Conversation } from '../../../../../shared/domain/chat';

// ---- Mocks ---------------------------------------------------------------
//
// `ConversationList` reads from several stores/hooks. We mock each one so the
// component renders in isolation without IPC, react-query providers, or
// zustand state setup. Mirrors the pattern in `composer.test.tsx` and
// `dialog-approval-card.test.tsx`.

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? k,
  }),
}));

// vi.hoisted so the factories below can share a mutable list with the test
// helpers — we flip `mockConversations` per test to drive the render.
const { mockConversations } = vi.hoisted(() => ({
  mockConversations: { current: [] as Conversation[] },
}));

vi.mock('../../hooks/use-conversations', () => ({
  useConversations: () => ({
    data: mockConversations.current,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('../../state/chat-slice', () => ({
  useChatStore: (selector: (s: unknown) => unknown) =>
    selector({
      activeConversationId: null,
      setActiveConversation: vi.fn(),
    }),
}));

vi.mock('../../state/group-slice', () => ({
  useGroupStore: (selector: (s: unknown) => unknown) =>
    selector({
      openNewChatModal: vi.fn(),
    }),
}));

vi.mock('../../../auth/state/auth-slice', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ state: { kind: 'loggedOut' } }),
}));

vi.mock('../../../../hooks/use-ipc', () => ({
  useIpc: () => vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('../../../../components/toast-overlay', () => ({
  toastStore: { getState: () => ({ push: vi.fn() }) },
}));

// Import AFTER mocks are registered so the component picks them up.
import { ConversationList } from '../conversation-list';

function makeConv(
  partial: { id: string; title: string; unreadCount: number; lastMessageAt: string | null },
): Conversation {
  return {
    id: partial.id,
    type: 'direct',
    title: partial.title,
    summary: null,
    participants: [
      { id: 'u1', name: 'Other', type: 'human', avatar: null, ownerId: null, ownerName: null, role: null },
    ],
    lastMessagePreview: null,
    lastMessageAt: partial.lastMessageAt,
    unreadCount: partial.unreadCount,
    createdAt: '2026-05-20T00:00:00',
    updatedAt: '2026-05-20T00:00:00',
  };
}

function renderWithConversations(
  convs: Array<{ id: string; title: string; unreadCount: number; lastMessageAt: string | null }>,
) {
  mockConversations.current = convs.map(makeConv);
  return render(<ConversationList />);
}

beforeEach(() => {
  // Pin "now" to 2026-05-20 14:30 local time so `formatConversationTime`'s
  // today-branch fires for the fixtures below (they're stamped 2026-05-20).
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-20T14:30:00'));
  mockConversations.current = [];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ConversationList row layout', () => {
  it('renders the timestamp slot for every conversation', () => {
    renderWithConversations([
      { id: 'a', title: 'Alice', unreadCount: 0, lastMessageAt: '2026-05-20T09:00:00' },
      { id: 'b', title: 'Bob', unreadCount: 3, lastMessageAt: '2026-05-20T10:00:00' },
    ]);
    // Both rows show a timestamp (HH:MM since they're "today" relative to
    // the faked system clock). Resilient to format choice.
    expect(screen.getAllByText(/\d{1,2}:\d{2}/)).toHaveLength(2);
  });

  it('shows an unread badge when unreadCount > 0', () => {
    renderWithConversations([
      { id: 'b', title: 'Bob', unreadCount: 3, lastMessageAt: '2026-05-20T10:00:00' },
    ]);
    const badge = screen.getByTestId('unread-badge');
    expect(badge.textContent).toBe('3');
  });

  it('caps badge at "99+" for large unread counts', () => {
    renderWithConversations([
      { id: 'b', title: 'Bob', unreadCount: 250, lastMessageAt: '2026-05-20T10:00:00' },
    ]);
    const badge = screen.getByTestId('unread-badge');
    expect(badge.textContent).toBe('99+');
  });

  it('does NOT render an unread badge when unreadCount === 0', () => {
    renderWithConversations([
      { id: 'a', title: 'Alice', unreadCount: 0, lastMessageAt: '2026-05-20T09:00:00' },
    ]);
    expect(screen.queryByTestId('unread-badge')).toBeNull();
  });

  it('placeholder span uses visibility:hidden with "1" content for stable width', () => {
    renderWithConversations([
      { id: 'a', title: 'Alice', unreadCount: 0, lastMessageAt: '2026-05-22T09:00:00' },
    ]);
    // The badge testid only appears when unread > 0. For unread = 0 the placeholder
    // is rendered as a hidden faux-badge: same Tailwind classes (text-xs px-1.5),
    // visibility hidden, content "1".
    const placeholder = screen.getByText('1', { selector: '[aria-hidden="true"]' });
    expect(placeholder).toBeTruthy();
    expect(placeholder.style.visibility).toBe('hidden');
  });
});
