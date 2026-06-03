import { useMemo, useState, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Search, X, MessageSquare, User, Cpu, Zap, Users, ChevronDown, Trash2, Pencil, Check } from 'lucide-react';
import { useConversations } from '../hooks/use-conversations';
import { useChatStore } from '../state/chat-slice';
import { useGroupStore } from '../state/group-slice';
import { useAuthStore } from '../../auth/state/auth-slice';
import { useIpc } from '../../../hooks/use-ipc';
import type { Conversation } from '../../../../shared/domain/chat';
import type { TFunction } from 'i18next';
import { Button } from '../../../components/ui/button';
import { toastStore } from '../../../components/toast-overlay';
import { formatConversationTime } from '../../../lib/format-conversation-time';

type ConversationFilter = 'all' | 'people' | 'agents' | 'agentDialogs' | 'groups';

const FILTERS: ConversationFilter[] = ['all', 'people', 'agents', 'agentDialogs', 'groups'];

const FILTER_ICONS: Record<ConversationFilter, typeof Search> = {
  all: MessageSquare,
  people: User,
  agents: Cpu,
  agentDialogs: Zap,
  groups: Users,
};

const FILTER_COLORS: Record<ConversationFilter, string> = {
  all: 'var(--color-brand-500)',
  people: 'var(--color-info)',
  agents: 'var(--color-purple)',
  agentDialogs: 'var(--color-warning)',
  groups: 'var(--color-danger)',
};

function displayTitle(c: Conversation, currentUserId: string | null): string {
  if (c.title) return c.title;
  if (c.type === 'group') {
    return c.participants.slice(0, 3).map((p) => p.name).join(', ') || c.id;
  }
  if (c.type === 'direct') {
    const other = c.participants.find((p) => p.id !== currentUserId) ?? c.participants[0];
    if (other) return other.name;
    return c.id;
  }
  return c.id;
}

function previewText(c: Conversation, t: TFunction<'chat'>): string {
  if (c.lastMessagePreview && c.lastMessagePreview.length > 0) return c.lastMessagePreview;
  if (c.summary && c.summary.length > 0) return c.summary;
  if (c.type === 'group') return t('group.memberCount', { count: c.participants.length });
  return '';
}

function matchesFilter(c: Conversation, filter: ConversationFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'people':
      return c.type === 'direct' && c.participants.every((p) => p.type === 'human');
    case 'agents':
      return c.type === 'direct' && c.participants.some((p) => p.type === 'agent');
    case 'agentDialogs':
      return c.type === 'agent_task';
    case 'groups':
      return c.type === 'group';
  }
}

function matchesSearch(c: Conversation, needle: string): boolean {
  if (needle.length === 0) return true;
  if ((c.title ?? '').toLowerCase().includes(needle)) return true;
  if (c.participants.some((p) => p.name.toLowerCase().includes(needle))) return true;
  if ((c.lastMessagePreview ?? '').toLowerCase().includes(needle)) return true;
  return false;
}

export function ConversationList() {
  const { t } = useTranslation('chat');
  const { data, isLoading } = useConversations();
  const activeId = useChatStore((s) => s.activeConversationId);
  const setActive = useChatStore((s) => s.setActiveConversation);
  const openNewChatModal = useGroupStore((s) => s.openNewChatModal);
  const currentUserId = useAuthStore((s) =>
    s.state.kind === 'loggedIn' ? s.state.user.id : null,
  );

  const [searchText, setSearchText] = useState('');
  const [filter, setFilter] = useState<ConversationFilter>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  // Right-click context menu state — anchored to the conversation row.
  const [contextMenu, setContextMenu] = useState<
    | { conversationId: string; x: number; y: number }
    | null
  >(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const ipc = useIpc();
  const qc = useQueryClient();
  const deleteConv = useMutation({
    mutationFn: (id: string) => ipc('chat.conversations.delete', { id }),
    onSuccess: (_v, id) => {
      if (activeId === id) setActive(null);
      void qc.invalidateQueries({ queryKey: ['chat.conversations'] });
      setConfirmDeleteId(null);
    },
    onError: () => toastStore.getState().push({
      message: t('deleteConversationFailed', { defaultValue: 'Failed to delete conversation' }),
      level: 'error',
    }),
  });

  // Inline-edit state for agent-chat summary (mirrors macOS pencil icon +
  // inline TextField at ConversationListView.swift:370-470). 20-char cap.
  const [editingSummaryId, setEditingSummaryId] = useState<string | null>(null);
  const [summaryDraft, setSummaryDraft] = useState('');
  const updateSummary = useMutation({
    mutationFn: (vars: { conversationId: string; summary: string }) =>
      ipc('chat.updateSummary', vars),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chat.conversations'] });
      setEditingSummaryId(null);
    },
    onError: () => toastStore.getState().push({
      message: t('updateSummaryFailed', { defaultValue: 'Failed to update summary' }),
      level: 'error',
    }),
  });

  // Dismiss context menu on any outside interaction.
  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    window.addEventListener('mousedown', dismiss);
    window.addEventListener('blur', dismiss);
    window.addEventListener('keydown', dismiss);
    return () => {
      window.removeEventListener('mousedown', dismiss);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('keydown', dismiss);
    };
  }, [contextMenu]);

  // Close filter menu on outside click
  useEffect(() => {
    if (!filterOpen) return;
    const onClick = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [filterOpen]);

  const filtered = useMemo(() => {
    const needle = searchText.trim().toLowerCase();
    return (data ?? []).filter(
      (c) => matchesFilter(c, filter) && matchesSearch(c, needle),
    );
  }, [data, filter, searchText]);

  // Hoist weekday lookup + yesterday label out of the row callback so we
  // call `t()` 8× per render of the list (not 8× per row).
  const weekdays = useMemo(
    () => [
      t('time.weekday.sun', { defaultValue: 'Sun' }),
      t('time.weekday.mon', { defaultValue: 'Mon' }),
      t('time.weekday.tue', { defaultValue: 'Tue' }),
      t('time.weekday.wed', { defaultValue: 'Wed' }),
      t('time.weekday.thu', { defaultValue: 'Thu' }),
      t('time.weekday.fri', { defaultValue: 'Fri' }),
      t('time.weekday.sat', { defaultValue: 'Sat' }),
    ],
    [t],
  );
  const yesterday = useMemo(
    () => t('time.yesterday', { defaultValue: 'Yesterday' }),
    [t],
  );

  if (isLoading) return null;

  const FilterIcon = FILTER_ICONS[filter];

  return (
    <div className="flex flex-col h-full">
      {/* Header: + button */}
      <div
        className="flex items-center justify-end px-2 py-1.5"
        style={{ borderBottom: '1px solid var(--color-border-subtle)' }}
      >
        <Button
          size="sm"
          variant="ghost"
          onClick={openNewChatModal}
          aria-label={t('newChat.title', { defaultValue: 'New Conversation' })}
        >
          ＋
        </Button>
      </div>

      {/* Search */}
      <div style={{ padding: '8px 12px 0' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            background: 'var(--color-bg-surface-2)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <Search size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} aria-hidden />
          <input
            type="text"
            placeholder={t('search', { defaultValue: 'Search' })}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 13,
              color: 'var(--color-text-primary)',
              minWidth: 0,
            }}
          />
          {searchText && (
            <button
              type="button"
              onClick={() => setSearchText('')}
              aria-label={t('clearSearch', { defaultValue: 'Clear' })}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                display: 'flex',
                color: 'var(--color-text-muted)',
              }}
            >
              <X size={14} aria-hidden />
            </button>
          )}
        </div>
      </div>

      {/* Filter dropdown */}
      <div
        ref={filterRef}
        style={{ padding: '8px 12px 0', position: 'relative' }}
      >
        <button
          type="button"
          onClick={() => setFilterOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={filterOpen}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            background: 'var(--color-bg-surface-2)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer',
            color: 'var(--color-text-primary)',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          <span
            aria-hidden
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 20,
              height: 20,
              borderRadius: 'var(--radius-sm)',
              background: `color-mix(in srgb, ${FILTER_COLORS[filter]} 12%, transparent)`,
              color: FILTER_COLORS[filter],
            }}
          >
            <FilterIcon size={12} aria-hidden />
          </span>
          <span>{t(`filter.${filter}`, { defaultValue: filter })}</span>
          <ChevronDown size={12} style={{ color: 'var(--color-text-muted)' }} aria-hidden />
        </button>

        {filterOpen && (
          <ul
            role="menu"
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 12,
              right: 12,
              listStyle: 'none',
              margin: 0,
              padding: 4,
              background: 'var(--color-bg-app)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-popover, 0 4px 12px var(--color-scrim))',
              zIndex: 20,
            }}
          >
            {FILTERS.map((f) => {
              const Icon = FILTER_ICONS[f];
              return (
                <li key={f}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setFilter(f);
                      setFilterOpen(false);
                    }}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      background:
                        filter === f ? 'var(--color-bg-surface-2)' : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--color-text-primary)',
                      fontSize: 13,
                      textAlign: 'left',
                    }}
                  >
                    <Icon size={14} style={{ color: FILTER_COLORS[f] }} aria-hidden />
                    {t(`filter.${f}`, { defaultValue: f })}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* List */}
      {!data || filtered.length === 0 ? (
        <div
          className="p-4 text-sm"
          style={{ color: 'var(--color-text-muted)', flex: 1 }}
        >
          {data && data.length > 0
            ? t('noMatchingConversations', { defaultValue: 'No matching conversations' })
            : '—'}
        </div>
      ) : (
        <ul
          className="flex flex-col gap-1 p-2 overflow-y-auto"
          style={{ minWidth: 'var(--sidebar-width)', flex: 1 }}
        >
          {filtered.map((c) => {
            const selected = c.id === activeId;
            const preview = previewText(c, t);
            const isAgent =
              c.type === 'agent_task' ||
              c.participants.some((p) => p.type === 'agent');
            return (
              <li key={c.id}>
                <div
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ conversationId: c.id, x: e.clientX, y: e.clientY });
                  }}
                  style={{
                    background: selected ? 'var(--color-bg-overlay)' : 'transparent',
                    borderRadius: 'var(--radius-md)',
                    padding: '8px 12px',
                    color: 'var(--color-text-primary)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    cursor: 'pointer',
                  }}
                  onClick={() => setActive(c.id)}
                >
                  {/* Title row — title on the left, right-side stack pins
                      timestamp + unread badge so the row height does not
                      shift on unread→read transitions. */}
                  <div className="text-sm font-medium flex justify-between items-baseline gap-2">
                    <span className="truncate flex items-center gap-1.5 min-w-0">
                      <span className="truncate">{displayTitle(c, currentUserId)}</span>
                      {isAgent && (
                        <span style={{
                          fontSize: 10, fontWeight: 700,
                          padding: '1px 4px', borderRadius: 3,
                          background: 'var(--color-purple-badge-bg)',
                          color: 'var(--color-purple)',
                          flexShrink: 0,
                        }}>AI</span>
                      )}
                      {isAgent && editingSummaryId !== c.id && (
                        <button
                          type="button"
                          aria-label={t('editSummary', { defaultValue: 'Edit summary' })}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingSummaryId(c.id);
                            setSummaryDraft(c.summary ?? '');
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            padding: 2,
                            display: 'inline-flex',
                            color: 'var(--color-text-muted)',
                            flexShrink: 0,
                          }}
                        >
                          <Pencil size={12} aria-hidden />
                        </button>
                      )}
                    </span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span
                        className="text-xs"
                        style={{ color: 'var(--color-text-secondary)' }}
                      >
                        {formatConversationTime(c.lastMessageAt ?? null, new Date(), {
                          yesterday,
                          weekdays,
                        })}
                      </span>
                      {c.unreadCount > 0 ? (
                        <span
                          data-testid="unread-badge"
                          className="text-xs px-1.5"
                          style={{
                            background: 'var(--color-brand-500)',
                            color: 'var(--color-on-status)',
                            borderRadius: 'var(--radius-sm)',
                            minWidth: 18,
                            textAlign: 'center',
                          }}
                        >
                          {c.unreadCount > 99 ? '99+' : c.unreadCount}
                        </span>
                      ) : (
                        // Reserve the single-digit badge's rendered width (minWidth 18 + Tailwind
                        // px-1.5 padding → ~19 px outer) so the right-stack width doesn't shift
                        // for the typical 1-9 unread → 0 read transition. Multi-digit transitions
                        // (10+ → 0) still have a small reflow, in the title-widens direction.
                        <span
                          aria-hidden
                          className="text-xs px-1.5"
                          style={{
                            visibility: 'hidden',
                            minWidth: 18,
                            textAlign: 'center',
                          }}
                        >
                          1
                        </span>
                      )}
                    </div>
                  </div>
                  {isAgent && editingSummaryId === c.id ? (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{ display: 'flex', gap: 4, marginTop: 2 }}
                    >
                      <input
                        autoFocus
                        type="text"
                        maxLength={20}
                        value={summaryDraft}
                        onChange={(e) => setSummaryDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            updateSummary.mutate({
                              conversationId: c.id,
                              summary: summaryDraft.trim(),
                            });
                          } else if (e.key === 'Escape') {
                            setEditingSummaryId(null);
                          }
                        }}
                        placeholder={t('summaryPlaceholder', { defaultValue: 'Summary (≤ 20 chars)' })}
                        style={{
                          flex: 1,
                          fontSize: 12,
                          padding: '2px 6px',
                          background: 'var(--color-bg-surface-2)',
                          border: '1px solid var(--color-border-subtle)',
                          borderRadius: 'var(--radius-sm)',
                          color: 'var(--color-text-primary)',
                          minWidth: 0,
                        }}
                      />
                      <button
                        type="button"
                        aria-label={t('saveSummary', { defaultValue: 'Save' })}
                        onClick={() =>
                          updateSummary.mutate({
                            conversationId: c.id,
                            summary: summaryDraft.trim(),
                          })
                        }
                        disabled={updateSummary.isPending}
                        style={{
                          background: 'var(--color-brand-500)',
                          color: 'var(--color-on-status)',
                          border: 'none',
                          borderRadius: 'var(--radius-sm)',
                          padding: '2px 6px',
                          cursor: 'pointer',
                          display: 'inline-flex',
                        }}
                      >
                        <Check size={12} aria-hidden />
                      </button>
                    </div>
                  ) : preview ? (
                    <div
                      className="text-xs truncate"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      {preview}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {contextMenu && (
        <ul
          role="menu"
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            listStyle: 'none',
            margin: 0,
            padding: 4,
            background: 'var(--color-bg-app)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-popover, 0 4px 12px var(--color-scrim))',
            zIndex: 1000,
            minWidth: 160,
          }}
        >
          <li>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setConfirmDeleteId(contextMenu.conversationId);
                setContextMenu(null);
              }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-danger)',
                fontSize: 13,
                textAlign: 'left',
              }}
            >
              <Trash2 size={14} aria-hidden />
              {t('deleteConversation', { defaultValue: 'Delete conversation' })}
            </button>
          </li>
        </ul>
      )}

      {confirmDeleteId && (
        <div
          onClick={() => setConfirmDeleteId(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--color-scrim)',
            zIndex: 1100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            data-testid="delete-conversation-confirm"
            style={{
              background: 'var(--color-bg-app)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-lg)',
              padding: 20,
              minWidth: 320,
              maxWidth: 420,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: 15,
                fontWeight: 600,
                color: 'var(--color-text-primary)',
              }}
            >
              {t('confirmDeleteConversation', {
                defaultValue: 'Delete this conversation?',
              })}
            </h3>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: 'var(--color-text-secondary)',
              }}
            >
              {t('confirmDeleteConversationBody', {
                defaultValue: 'Messages will be removed locally. This cannot be undone.',
              })}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDeleteId(null)}
              >
                {t('filter.cancel', { defaultValue: 'Cancel' })}
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={deleteConv.isPending}
                onClick={() => deleteConv.mutate(confirmDeleteId)}
                style={{ background: 'var(--color-danger)' } as React.CSSProperties}
              >
                {t('delete', { defaultValue: 'Delete' })}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
