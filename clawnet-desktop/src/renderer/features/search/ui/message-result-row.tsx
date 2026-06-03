import { Fragment } from 'react';
import { useChatStore } from '../../chat/state/chat-slice';
import { useFlashingMessageStore } from '../state/flashing-message-slice';
import { useGlobalSearchStore } from '../state/global-search-slice';
import type { ChatMessage } from '../../../../shared/domain/chat';

interface Props {
  message: ChatMessage;
  /**
   * Switch the visible panel back to chat after jumping — needed when the
   * search modal is opened from any non-chat panel (contacts/agents/etc.).
   * The MessageList scrollIntoView only fires after the chat panel mounts.
   */
  onSwitchPanel: (panel: 'chat') => void;
  /**
   * Current search query, used to highlight matching substrings in the
   * preview (mirrors macOS GlobalSearchView.swift:202-229).
   */
  query?: string;
}

/**
 * Renders `text` with `query` matches wrapped in <mark>. Case-insensitive.
 * Empty/whitespace query → plain text.
 */
function highlight(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (q.length === 0) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let idx = lower.indexOf(needle);
  while (idx !== -1) {
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(
      <mark
        key={`m-${idx}`}
        style={{
          background: 'var(--color-info-badge-bg)',
          color: 'var(--color-info)',
          padding: '0 2px',
          borderRadius: 2,
          fontWeight: 600,
        }}
      >
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    i = idx + q.length;
    idx = lower.indexOf(needle, i);
  }
  if (i < text.length) parts.push(text.slice(i));
  return <Fragment>{parts}</Fragment>;
}

/**
 * A single message hit. Clicking it:
 *  1. switches the active panel to `chat` (no-op if already there)
 *  2. sets the active conversation
 *  3. fires a flash so the destination MessageList scrolls + highlights
 *  4. closes the search modal
 */
export function MessageResultRow({ message, onSwitchPanel, query = '' }: Props) {
  const setActive = useChatStore((s) => s.setActiveConversation);
  const flash = useFlashingMessageStore((s) => s.flash);
  const closeSearch = useGlobalSearchStore((s) => s.close);

  const onJump = () => {
    onSwitchPanel('chat');
    setActive(message.conversationId);
    flash(message.id);
    closeSearch();
  };

  const text = (message.content as { text?: string | null }).text ?? '';
  const preview = text.length > 120 ? text.slice(0, 120) + '…' : text;

  return (
    <button
      type="button"
      onClick={onJump}
      data-testid={`search-message-${message.id}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '8px 12px',
        textAlign: 'left',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        borderRadius: 'var(--radius-sm)',
        width: '100%',
        color: 'var(--color-text-primary)',
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
        {message.sender.name} · {new Date(message.timestamp).toLocaleString()}
      </div>
      <div style={{ fontSize: 13 }}>
        {preview ? highlight(preview, query) : `[${message.contentType}]`}
      </div>
    </button>
  );
}
