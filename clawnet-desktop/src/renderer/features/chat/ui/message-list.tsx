import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MessagesSquare, Sparkles } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMessages } from '../hooks/use-messages';
import { useConversations } from '../hooks/use-conversations';
import { MessageBubble } from './message-bubble';
import { useFlashingMessageStore } from '../../search/state/flashing-message-slice';
import { useStreamingStore } from '../state/streaming-slice';

function ChatEmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-center justify-center w-full h-full">
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          padding: 24,
          textAlign: 'center',
          maxWidth: 320,
        }}
      >
        <div
          aria-hidden
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 56,
            height: 56,
            borderRadius: 'var(--radius-lg)',
            background:
              'color-mix(in srgb, var(--color-brand-500) 10%, transparent)',
            color: 'var(--color-brand-500)',
          }}
        >
          {icon}
        </div>
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--color-text-primary)',
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Virtualized message list. Uses @tanstack/react-virtual with dynamic
 * size measurement (estimate 80px, then refines per-row on first paint).
 *
 * MessageList now owns its own scroll container (overflow-y-auto on
 * `scrollRef`); ChatContainer's outer wrapper is no longer scrollable.
 * This is required by react-virtual: the virtualizer's `getScrollElement`
 * must point at the element that actually scrolls, and overscan/scrollTo
 * must read/write its scrollTop directly.
 */
export function MessageList({ conversationId }: { conversationId: string | null }) {
  const { t } = useTranslation('chat');
  const { data, isLoading } = useMessages(conversationId);
  // A2A (agent-task) conversations need the "my own agent → my side"
  // bubble rule. macOS keys this off conversation.type == .agentTask.
  const { data: conversations } = useConversations();
  const isAgentDialog =
    conversations?.find((c) => c.id === conversationId)?.type === 'agent_task';
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const flashing = useFlashingMessageStore((s) => s.currentlyFlashing);
  const lastConvRef = useRef<string | null>(null);

  const messages = data?.messages ?? [];

  // Streaming deltas don't change the message count — they update an existing
  // message's content. Subscribe to a "total seq tick" so the auto-scroll
  // effect re-fires while content grows.
  const streamSeqTotal = useStreamingStore((s) => {
    let total = 0;
    for (const entry of Object.values(s.byId)) total += entry.seq ?? 0;
    return total;
  });

  // 80 was picked by sampling: short text messages render ~64px, but most
  // bubbles (with avatar + name + timestamp) land near 80. Dynamic
  // remeasure corrects within one paint, so the estimate only affects the
  // initial scrollbar guess.
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 80,
    overscan: 8,
    // Keying by message id lets the virtualizer remember measured sizes
    // even when items shift index (e.g. when older history loads at the
    // top). Without this, a re-order causes flicker as everything snaps
    // back to the 80px estimate.
    getItemKey: (index) => messages[index]?.id ?? index,
  });

  // Track whether the user is near the bottom by listening to the scroll
  // container's `scroll` event. We deliberately do NOT recompute this
  // on every render — that races with React's commit cycle when a new
  // message arrives: the messages.length update increments before the
  // virtualizer recomputes its range, so a render-time check would see
  // a stale `range.endIndex` and incorrectly flip the flag to false at
  // the exact moment we want auto-scroll to fire.
  //
  // Using the scroll event means:
  //   - User scrolls up → event fires → flag flips to false
  //   - User scrolls back down → event fires → flag flips to true
  //   - New message arrives (no user scroll) → flag preserved → scroll
  //     effect below reads "true" → scrollToIndex(last) runs → that
  //     programmatic scroll fires the same event → flag stays true.
  // 40px tolerance lets streaming bubbles or rendering jitter still count
  // as "at bottom".
  const isAtBottomRef = useRef(true);
  // Suppress auto-scroll for ~600ms after a search-flash so a streaming
  // delta doesn't immediately yank the user away from the highlighted
  // message they were trying to read.
  const flashCooldownUntilRef = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    // Set initial state once the scroll element is mounted.
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [conversationId]);

  // Auto-scroll moments:
  //   1. Switching conversation OR initial load: jump to bottom INSTANTLY.
  //   2. New message in the same conv: smooth-scroll if user is at bottom.
  //   3. Streaming delta grows an existing message: smooth-scroll if at bottom.
  // The rAF wrap lets react-virtual finish its measureElement pass on the
  // newly rendered row before we read totalSize — without it, scrollToIndex
  // uses the 80px estimate and lands above the actual bottom for one frame.
  useEffect(() => {
    if (!conversationId || messages.length === 0) return;
    const switched = lastConvRef.current !== conversationId;
    lastConvRef.current = conversationId;
    if (!switched && !isAtBottomRef.current) return;
    if (!switched && Date.now() < flashCooldownUntilRef.current) return;
    const raf = requestAnimationFrame(() => {
      virtualizer.scrollToIndex(messages.length - 1, {
        align: 'end',
        behavior: switched ? 'auto' : 'smooth',
      });
      if (switched) isAtBottomRef.current = true;
    });
    return () => cancelAnimationFrame(raf);
  }, [conversationId, messages.length, streamSeqTotal, virtualizer]);

  // P2F: when a search result triggers a flash, scroll the highlighted
  // message into view. `align: 'center'` to keep it off the chrome.
  // Engages the cooldown so the next streaming delta tick doesn't
  // immediately scroll us back to the bottom.
  useEffect(() => {
    if (!flashing) return;
    const idx = messages.findIndex((m) => m.id === flashing);
    if (idx < 0) return;
    flashCooldownUntilRef.current = Date.now() + 600;
    virtualizer.scrollToIndex(idx, { align: 'center', behavior: 'smooth' });
  }, [flashing, messages, virtualizer]);

  if (!conversationId) {
    return (
      <ChatEmptyState
        icon={<MessagesSquare size={26} aria-hidden />}
        title={t('noConversation')}
        subtitle={t('noConversationSubtitle', {
          defaultValue: 'Pick a chat from the left or start a new one with +.',
        })}
      />
    );
  }

  if (isLoading) return null;

  if (messages.length === 0) {
    return (
      <ChatEmptyState
        icon={<Sparkles size={24} aria-hidden />}
        title={t('emptyMessages')}
      />
    );
  }

  const items = virtualizer.getVirtualItems();

  return (
    // `role="log" aria-live="polite"` lets screen readers announce new
    // incoming messages without interrupting the user.
    <div
      ref={scrollRef}
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      className="flex-1 min-h-0 overflow-y-auto"
    >
      <div
        // Inner sizer holds the full virtual height so the scrollbar
        // matches the un-virtualized layout.
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {items.map((vi) => {
          const m = messages[vi.index];
          if (!m) return null;
          const isFlashing = flashing === m.id;
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              ref={(el) => {
                virtualizer.measureElement(el);
                messageRefs.current[m.id] = el;
              }}
              data-testid={`message-${m.id}`}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`,
                padding: '4px 16px',
                background: isFlashing ? 'var(--color-info-badge-bg)' : 'transparent',
                transition: 'background 0.3s ease',
              }}
            >
              <MessageBubble message={m} isAgentDialog={isAgentDialog} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
