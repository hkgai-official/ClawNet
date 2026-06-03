import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import type { Conversation } from '../../../../shared/domain/chat';
import type { DialogSession } from '../../../../shared/domain/dialog';
import { Button } from '../../../components/ui/button';
import { useConnection } from '../../../hooks/use-connection';

interface ChatHeaderBarProps {
  conversation: Conversation;
  currentUserId: string | null;
  dialogSession?: DialogSession | null;
  onGroupDetail?: (() => void) | undefined;
}

/**
 * Unified header for direct / agent / group / agent-dialog conversations.
 * 1:1 port of macOS ChatHeaderBar (ChatContainerView.swift:703-787):
 *   - Avatar (initial of displayName, tinted by conversation type)
 *   - Name + role badge ("AI" for human↔agent, "A↔A" for A2A dialog)
 *   - Subtitle: member count for groups, connection state otherwise
 *   - ⓘ button on the right for groups (opens GroupDetailPanel)
 *
 * Previously the Win port rendered a header only for groups; direct and
 * agent conversations had no header at all. Surfacing this for every
 * conversation type is the round-4 audit's #1 priority.
 */
export function ChatHeaderBar({
  conversation,
  currentUserId,
  dialogSession,
  onGroupDetail,
}: ChatHeaderBarProps) {
  const { t } = useTranslation('chat');
  const { status } = useConnection();

  const isAgentDialog = conversation.type === 'agent_task';
  const isGroup = conversation.type === 'group';
  const otherParticipant =
    conversation.type === 'direct'
      ? conversation.participants.find((p) => p.id !== currentUserId) ??
        conversation.participants[0] ??
        null
      : null;
  const isAgentConversation = otherParticipant?.type === 'agent';

  const displayName = (() => {
    if (isAgentDialog && dialogSession) {
      const a = dialogSession.initiatorAgent.displayName;
      const b = dialogSession.responderAgent.displayName;
      return `${a} ↔ ${b}`;
    }
    if (otherParticipant && otherParticipant.name) return otherParticipant.name;
    if (isGroup) {
      return conversation.title || t('group.unnamed', { defaultValue: 'Group' });
    }
    return conversation.title ?? '—';
  })();

  const avatarBg = isAgentConversation || isAgentDialog
    ? 'var(--color-purple-badge-bg)'
    : isGroup
      ? 'var(--color-info-badge-bg)'
      : 'var(--color-bg-surface-2)';
  const avatarFg = isAgentConversation || isAgentDialog
    ? 'var(--color-purple)'
    : isGroup
      ? 'var(--color-info)'
      : 'var(--color-text-secondary)';

  const subtitle = (() => {
    if (isGroup) {
      return t('group.memberCount', { count: conversation.participants.length });
    }
    if (status === 'connected') {
      return otherParticipant?.type === 'agent'
        ? t('headerAgent', { defaultValue: 'Agent' })
        : t('headerOnline', { defaultValue: 'Online' });
    }
    return t(`sidebar.${status}`, { defaultValue: status });
  })();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 16px',
        borderBottom: '1px solid var(--color-border-subtle)',
        background: 'var(--color-bg-surface)',
        flexShrink: 0,
      }}
    >
      <div
        aria-hidden
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: avatarBg,
          color: avatarFg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        {displayName.slice(0, 1).toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            className="truncate"
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              minWidth: 0,
            }}
          >
            {displayName}
          </span>
          {isAgentDialog ? (
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                padding: '1px 4px',
                borderRadius: 3,
                background: 'var(--color-purple-badge-bg)',
                color: 'var(--color-purple)',
                flexShrink: 0,
              }}
            >
              A↔A
            </span>
          ) : isAgentConversation ? (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '1px 4px',
                borderRadius: 3,
                background: 'var(--color-purple-badge-bg)',
                color: 'var(--color-purple)',
                flexShrink: 0,
              }}
            >
              AI
            </span>
          ) : null}
        </div>
        <span
          style={{ fontSize: 11, color: 'var(--color-text-muted)' }}
        >
          {subtitle}
        </span>
      </div>
      {isGroup && onGroupDetail && (
        <Button
          size="sm"
          variant="ghost"
          onClick={onGroupDetail}
          aria-label={t('group.groupDetail')}
        >
          <Info size={16} aria-hidden />
        </Button>
      )}
    </div>
  );
}
