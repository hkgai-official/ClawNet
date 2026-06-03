import { useTranslation } from 'react-i18next';
import type { ParticipantRole } from '../../../../shared/domain/chat';

/**
 * Tiny owner/admin pill for group conversations.
 *
 * Used in two places:
 *   - `GroupDetailPanel` member list (size='xs')
 *   - `MessageBubble` sender label in group conversations (size='xs')
 *
 * Returns null for `member` / null / undefined — only owner + admin get a
 * visible badge (matches the macOS `GroupDetailView.swift:113-129` logic).
 */
interface Props {
  role: ParticipantRole | null | undefined;
  size?: 'sm' | 'xs';
}

export function RoleBadge({ role, size = 'sm' }: Props) {
  const { t } = useTranslation('chat');
  if (role !== 'owner' && role !== 'admin') return null;
  const isOwner = role === 'owner';
  const fontSize = size === 'xs' ? 9 : 10;
  return (
    <span
      data-testid={`role-badge-${role}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        padding: size === 'xs' ? '1px 4px' : '2px 6px',
        borderRadius: 3,
        fontSize,
        fontWeight: 700,
        color: isOwner ? 'var(--color-warning)' : 'var(--color-info)',
        background: isOwner ? 'var(--color-warning-badge-bg)' : 'var(--color-info-badge-bg)',
      }}
    >
      <span aria-hidden style={{ fontSize: fontSize + 1 }}>{isOwner ? '👑' : '🛡'}</span>
      {isOwner ? t('group.owner') : t('group.admin')}
    </span>
  );
}
