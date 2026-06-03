import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useMembers,
  useRemoveMember,
  useUpdateConversationTitle,
} from '../hooks/use-group';
import { useGroupStore } from '../state/group-slice';
import { useChatStore } from '../state/chat-slice';
import { useAuthStore } from '../../auth/state/auth-slice';
import { useConversations } from '../hooks/use-conversations';
import { RoleBadge } from './role-badge';
import { Button } from '../../../components/ui/button';
import { toastStore } from '../../../components/toast-overlay';

/**
 * Right-side panel for group conversation management. 1:1 port of macOS
 * `GroupDetailView.swift`: title with owner-only rename action, scrollable
 * member list sorted by role then name, role badges via `RoleBadge`,
 * remove-member buttons (owner-only, can't remove self), and an
 * "Invite members" footer that opens `InviteMembersModal`.
 *
 * Returns null unless the active conversation is a `group`.
 *
 * Roles + actions (mirrors macOS GroupDetailView.swift:134-165):
 *   - Owner: can rename, remove anyone except themselves, invite
 *   - Admin: can remove non-admin / non-owner members, invite
 *   - Plain member: can leave (removes self)
 */
export function GroupDetailPanel() {
  const { t } = useTranslation('chat');
  const open = useGroupStore((s) => s.groupDetailOpen);
  const setOpen = useGroupStore((s) => s.setGroupDetailOpen);
  const openInvite = useGroupStore((s) => s.openInviteModal);

  const activeConvId = useChatStore((s) => s.activeConversationId);
  const conversations = useConversations();
  const conv = conversations.data?.find((c) => c.id === activeConvId);

  const members = useMembers(activeConvId);
  const remove = useRemoveMember(activeConvId ?? '');
  const rename = useUpdateConversationTitle(activeConvId ?? '');
  // auth-slice exposes `state: AuthState` where state.kind === 'loggedIn'
  // carries `user`. Mirrors the message-bubble pattern.
  const currentUserId = useAuthStore((s) =>
    s.state.kind === 'loggedIn' ? s.state.user.id : null,
  );

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  if (!open || !conv || conv.type !== 'group' || !activeConvId) return null;

  const sortedMembers = [...(members.data ?? [])].sort((a, b) => {
    const rank = (r: string | null | undefined) =>
      r === 'owner' ? 0 : r === 'admin' ? 1 : 2;
    const ra = rank(a.role);
    const rb = rank(b.role);
    return ra !== rb ? ra - rb : a.name.localeCompare(b.name);
  });

  const myRole = sortedMembers.find((m) => m.id === currentUserId)?.role ?? null;
  const meIsOwner = myRole === 'owner';
  const meIsAdmin = myRole === 'admin';
  /** Admins can also remove members (mirrors macOS GroupDetailView.swift:134-144).
   *  Restrictions: cannot remove self via the row button (use Leave Group);
   *  admins cannot remove owner or fellow admins; only the owner can remove an admin. */
  function canRemove(target: { id: string; role?: string | null | undefined }): boolean {
    if (target.id === currentUserId) return false;
    if (meIsOwner) return true;
    if (meIsAdmin) {
      return target.role !== 'owner' && target.role !== 'admin';
    }
    return false;
  }

  const startRename = () => {
    setEditingTitle(true);
    setTitleDraft(conv.title ?? '');
  };
  const commitRename = () => {
    const next = titleDraft.trim();
    if (next.length === 0 || next === conv.title) {
      setEditingTitle(false);
      return;
    }
    rename.mutate(next, {
      onSuccess: () => setEditingTitle(false),
      onError: () => toastStore.getState().push({
        message: t('group.renameFailed'),
        level: 'error',
      }),
    });
  };

  const handleRemove = (memberId: string, memberName: string) => {
    if (!confirm(t('group.confirmRemove', { name: memberName }))) return;
    remove.mutate(memberId, {
      onError: () => toastStore.getState().push({
        message: t('group.removeFailed'),
        level: 'error',
      }),
    });
  };

  const handleLeaveGroup = () => {
    if (!currentUserId) return;
    if (!confirm(t('group.confirmLeave', { defaultValue: 'Leave this group?' }))) return;
    remove.mutate(currentUserId, {
      onSuccess: () => setOpen(false),
      onError: () => toastStore.getState().push({
        message: t('group.leaveFailed', { defaultValue: 'Failed to leave group' }),
        level: 'error',
      }),
    });
  };

  return (
    <aside
      style={{
        width: 320, minWidth: 320, maxWidth: 320,
        borderLeft: '1px solid var(--color-border-subtle)',
        background: 'var(--color-bg-surface)',
        display: 'flex', flexDirection: 'column', height: '100%',
      }}
    >
      <header
        style={{
          padding: 16,
          borderBottom: '1px solid var(--color-border-subtle)',
          flexShrink: 0,
        }}
      >
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          {t('group.groupDetail')}
        </div>
        {editingTitle ? (
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setEditingTitle(false);
              }}
              style={{
                flex: 1, padding: '4px 8px', fontSize: 14,
                background: 'var(--color-bg-surface-2)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text-primary)',
              }}
            />
            <Button
              size="sm"
              variant="primary"
              onClick={commitRename}
              disabled={rename.isPending}
            >
              ✓
            </Button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{conv.title ?? '—'}</span>
            {meIsOwner && (
              <Button
                size="sm"
                variant="ghost"
                onClick={startRename}
                aria-label={t('group.rename')}
              >
                ✎
              </Button>
            )}
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 4 }}>
          {t('group.memberCount', { count: sortedMembers.length })}
        </div>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {sortedMembers.length === 0 && (
          <div
            style={{
              padding: 16,
              fontSize: 12,
              color: 'var(--color-text-secondary)',
            }}
          >
            {t('group.noMembers')}
          </div>
        )}
        {sortedMembers.map((m) => (
          <div
            key={m.id}
            data-testid={`group-member-${m.id}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '6px 16px',
            }}
          >
            <div
              style={{
                width: 30, height: 30, borderRadius: '50%',
                background: 'var(--color-bg-surface-2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, color: 'var(--color-text-secondary)',
              }}
            >
              {m.name.slice(0, 1).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 13 }}>{m.name}</span>
                <RoleBadge role={m.role} size="xs" />
              </div>
            </div>
            {canRemove(m) && (
              <button
                onClick={() => handleRemove(m.id, m.name)}
                aria-label={t('group.remove')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--color-danger)',
                  fontSize: 14,
                }}
              >
                ✗
              </button>
            )}
          </div>
        ))}
      </div>

      <footer
        style={{
          padding: 12,
          borderTop: '1px solid var(--color-border-subtle)',
          display: 'flex',
          gap: 8,
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        <Button
          size="sm"
          variant="secondary"
          onClick={() => openInvite(activeConvId)}
        >
          {t('group.inviteMembers')}
        </Button>
        {/* Leave Group is available for non-owners (mirrors macOS
            GroupDetailView.swift:159-165). Owners must transfer ownership
            or delete the group via the conversation list context menu. */}
        {!meIsOwner && myRole !== null && (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleLeaveGroup}
            disabled={remove.isPending}
            style={{ color: 'var(--color-danger)' } as React.CSSProperties}
          >
            {t('group.leaveGroup', { defaultValue: 'Leave group' })}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t('group.cancel')}
        </Button>
      </footer>
    </aside>
  );
}
