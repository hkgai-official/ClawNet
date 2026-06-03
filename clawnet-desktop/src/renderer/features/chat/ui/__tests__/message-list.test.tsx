// @vitest-environment jsdom
//
// MessageList tests focus on the *integration glue* — what we ask the
// virtualizer to do — not the virtualizer's own layout. react-virtual
// in jsdom can't measure heights (no real layout), so we mock the
// useVirtualizer hook to a controllable fake and verify the calls
// MessageList makes against it.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChatMessage } from '../../../../../shared/domain/chat';

const scrollToIndex = vi.fn();
const measureElement = vi.fn();
const virtualizerRangeRef = { current: { startIndex: 0, endIndex: 0 } };

// Fake useVirtualizer — captures count, returns deterministic items.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number; getItemKey?: (i: number) => string | number }) => {
    return {
      get range() {
        return virtualizerRangeRef.current;
      },
      scrollToIndex,
      measureElement,
      getTotalSize: () => opts.count * 80,
      getVirtualItems: () =>
        Array.from({ length: opts.count }).map((_, i) => ({
          index: i,
          key: opts.getItemKey ? opts.getItemKey(i) : i,
          start: i * 80,
          size: 80,
        })),
    };
  },
}));

// useMessages is the data source — replace with a controllable stub.
const messagesRef: { current: { messages: ChatMessage[]; isLoading: boolean } } = {
  current: { messages: [], isLoading: false },
};
vi.mock('../../hooks/use-messages', () => ({
  useMessages: () => ({
    data: { messages: messagesRef.current.messages },
    isLoading: messagesRef.current.isLoading,
  }),
}));

vi.mock('../../hooks/use-conversations', () => ({
  useConversations: () => ({ data: [] }),
}));

vi.mock('../message-bubble', () => ({
  MessageBubble: ({ message }: { message: ChatMessage }) => (
    <div data-testid={`bubble-${message.id}`}>{message.id}</div>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const flashingRef = { current: null as string | null };
vi.mock('../../../search/state/flashing-message-slice', () => ({
  useFlashingMessageStore: (selector: (s: { currentlyFlashing: string | null }) => unknown) =>
    selector({ currentlyFlashing: flashingRef.current }),
}));

import { MessageList } from '../message-list';

function makeMsg(id: string): ChatMessage {
  return {
    id,
    conversationId: 'c1',
    sender: { id: 'u1', name: 'X', type: 'human' },
    contentType: 'text',
    content: { text: id },
    timestamp: '2025-01-01T00:00:00Z',
    status: 'sent',
  } as ChatMessage;
}

function renderList(conversationId: string | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <MessageList conversationId={conversationId} />
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  cleanup();
  scrollToIndex.mockClear();
  measureElement.mockClear();
  virtualizerRangeRef.current = { startIndex: 0, endIndex: 0 };
  messagesRef.current = { messages: [], isLoading: false };
  flashingRef.current = null;
  // Run rAF callbacks synchronously so the scroll effect lands inside
  // `act()` instead of waiting for the next paint that never comes in jsdom.
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    cb(0);
    return 0;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

describe('MessageList — empty / loading states', () => {
  it('renders the no-conversation empty state when conversationId is null', () => {
    renderList(null);
    expect(screen.getByText('noConversation')).toBeTruthy();
  });

  it('renders the empty-messages state when messages array is empty', () => {
    messagesRef.current = { messages: [], isLoading: false };
    renderList('c1');
    expect(screen.getByText('emptyMessages')).toBeTruthy();
  });

  it('renders nothing while loading', () => {
    messagesRef.current = { messages: [], isLoading: true };
    const { container } = renderList('c1');
    expect(container.firstChild).toBeNull();
  });
});

describe('MessageList — auto-scroll', () => {
  it('scrolls to last index instantly when conversation is first opened', async () => {
    messagesRef.current = { messages: [makeMsg('m1'), makeMsg('m2')], isLoading: false };
    renderList('c1');
    // rAF wrapper — flush a microtask + a macrotask.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(scrollToIndex).toHaveBeenCalled();
    const [idx, opts] = scrollToIndex.mock.calls.at(-1)!;
    expect(idx).toBe(1);
    expect((opts as { align: string; behavior: string }).align).toBe('end');
    expect((opts as { behavior: string }).behavior).toBe('auto');
  });

  it('uses smooth behavior for new-message arrival in same conversation (at bottom)', async () => {
    messagesRef.current = { messages: [makeMsg('m1')], isLoading: false };
    virtualizerRangeRef.current = { startIndex: 0, endIndex: 0 };
    const { rerender, qc } = renderList('c1');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    scrollToIndex.mockClear();
    // Same conv, a new message arrived.
    messagesRef.current = { messages: [makeMsg('m1'), makeMsg('m2')], isLoading: false };
    virtualizerRangeRef.current = { startIndex: 0, endIndex: 1 };
    rerender(
      <QueryClientProvider client={qc}>
        <MessageList conversationId="c1" />
      </QueryClientProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const lastCall = scrollToIndex.mock.calls.at(-1);
    expect(lastCall).toBeTruthy();
    expect((lastCall![1] as { behavior: string }).behavior).toBe('smooth');
  });

  it('does NOT auto-scroll when user has scrolled up (isAtBottom false)', async () => {
    messagesRef.current = { messages: [makeMsg('m1'), makeMsg('m2'), makeMsg('m3')], isLoading: false };
    const { rerender, qc, container } = renderList('c1');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    scrollToIndex.mockClear();

    // Round-7: isAtBottomRef is now scroll-event driven, not range-driven.
    // Simulate the user scrolling up by setting the scroll container's
    // dimensions to indicate "not at bottom" and firing a scroll event.
    const scrollEl = container.querySelector('[role="log"]') as HTMLElement | null;
    expect(scrollEl).toBeTruthy();
    if (scrollEl) {
      Object.defineProperty(scrollEl, 'scrollTop', { value: 0, configurable: true });
      Object.defineProperty(scrollEl, 'scrollHeight', { value: 1000, configurable: true });
      Object.defineProperty(scrollEl, 'clientHeight', { value: 400, configurable: true });
      scrollEl.dispatchEvent(new Event('scroll'));
    }

    // New message arrives.
    messagesRef.current = {
      messages: [makeMsg('m1'), makeMsg('m2'), makeMsg('m3'), makeMsg('m4')],
      isLoading: false,
    };
    rerender(
      <QueryClientProvider client={qc}>
        <MessageList conversationId="c1" />
      </QueryClientProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(scrollToIndex).not.toHaveBeenCalled();
  });
});

describe('MessageList — flashing search jump', () => {
  it('scrolls to flashing message with center align', async () => {
    messagesRef.current = { messages: [makeMsg('m1'), makeMsg('m2'), makeMsg('m3')], isLoading: false };
    flashingRef.current = 'm2';
    renderList('c1');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const centerCall = scrollToIndex.mock.calls.find(
      (c) => (c[1] as { align: string }).align === 'center',
    );
    expect(centerCall).toBeTruthy();
    expect(centerCall![0]).toBe(1);
  });
});
