// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { MessageResultRow } from '../message-result-row';
import type { ChatMessage } from '../../../../../shared/domain/chat';

const setActive = vi.fn();
const flash = vi.fn();
const closeSearch = vi.fn();

vi.mock('../../../chat/state/chat-slice', () => ({
  useChatStore: (selector: (s: { setActiveConversation: typeof setActive }) => unknown) =>
    selector({ setActiveConversation: setActive }),
}));
vi.mock('../../state/flashing-message-slice', () => ({
  useFlashingMessageStore: (selector: (s: { flash: typeof flash }) => unknown) =>
    selector({ flash }),
}));
vi.mock('../../state/global-search-slice', () => ({
  useGlobalSearchStore: (selector: (s: { close: typeof closeSearch }) => unknown) =>
    selector({ close: closeSearch }),
}));

beforeEach(() => {
  cleanup();
  setActive.mockClear();
  flash.mockClear();
  closeSearch.mockClear();
});

function makeMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    conversationId: 'c1',
    sender: { id: 's1', name: 'Alice', type: 'human' },
    contentType: 'text',
    content: { text: 'hello world foo bar' } as ChatMessage['content'],
    timestamp: '2026-05-15T10:00:00Z',
    ...overrides,
  };
}

describe('MessageResultRow — highlight', () => {
  it('wraps case-insensitive query matches in <mark>', () => {
    const { container } = render(
      <MessageResultRow message={makeMsg()} onSwitchPanel={vi.fn()} query="World" />,
    );
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBe(1);
    expect(marks[0]?.textContent).toBe('world');
  });

  it('renders plain text when query is empty/whitespace', () => {
    const { container } = render(
      <MessageResultRow message={makeMsg()} onSwitchPanel={vi.fn()} query="   " />,
    );
    expect(container.querySelectorAll('mark').length).toBe(0);
    expect(container.textContent).toContain('hello world foo bar');
  });

  it('wraps multiple non-overlapping matches', () => {
    const { container } = render(
      <MessageResultRow
        message={makeMsg({ content: { text: 'foo foo foo' } as ChatMessage['content'] })}
        onSwitchPanel={vi.fn()}
        query="foo"
      />,
    );
    expect(container.querySelectorAll('mark').length).toBe(3);
  });
});

describe('MessageResultRow — preview truncation', () => {
  it('truncates text >120 chars with ellipsis', () => {
    const long = 'x'.repeat(200);
    render(
      <MessageResultRow message={makeMsg({ content: { text: long } as ChatMessage['content'] })} onSwitchPanel={vi.fn()} />,
    );
    const previews = screen.getAllByText(/x{120}…$/);
    expect(previews.length).toBeGreaterThan(0);
  });

  it('falls back to [contentType] placeholder when text is empty', () => {
    render(
      <MessageResultRow
        message={makeMsg({ contentType: 'file', content: {} as ChatMessage['content'] })}
        onSwitchPanel={vi.fn()}
      />,
    );
    expect(screen.getByText('[file]')).toBeTruthy();
  });
});

describe('MessageResultRow — click side effects', () => {
  it('clicking the row switches panel, activates conv, flashes message, closes search', () => {
    const onSwitchPanel = vi.fn();
    render(<MessageResultRow message={makeMsg()} onSwitchPanel={onSwitchPanel} />);
    fireEvent.click(screen.getByTestId('search-message-m1'));
    expect(onSwitchPanel).toHaveBeenCalledWith('chat');
    expect(setActive).toHaveBeenCalledWith('c1');
    expect(flash).toHaveBeenCalledWith('m1');
    expect(closeSearch).toHaveBeenCalledTimes(1);
  });
});
