import { useTranslation } from 'react-i18next';
import type { FriendRequest } from '../../../../shared/domain/contact';

interface Props {
  request: FriendRequest;
  onAccept: () => void;
  onReject: () => void;
  pending: boolean;
}

/**
 * Inbox row for a pending friend request. Ports `FriendRequestRow` from
 * macOS ContactsPanel.swift:185-232. Status non-pending hides the action
 * buttons (matches swift line 215).
 */
export function FriendRequestRow({ request, onAccept, onReject, pending }: Props) {
  const { t } = useTranslation('contacts');
  const initial = request.fromUserName.slice(0, 1).toUpperCase();

  return (
    <div
      data-testid={`friend-request-row-${request.id}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--color-warning-badge-bg)', color: 'var(--color-warning)',
        fontWeight: 500, fontSize: 14,
        flexShrink: 0,
      }}>
        {initial}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14 }}>{request.fromUserName}</div>
        {request.message && (
          <div style={{
            fontSize: 11, color: 'var(--color-text-secondary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {request.message}
          </div>
        )}
      </div>
      {request.status === 'pending' && (
        <>
          <button
            onClick={onAccept}
            disabled={pending}
            aria-label={t('accept')}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--color-success)', fontSize: 18,
            }}
          >✓</button>
          <button
            onClick={onReject}
            disabled={pending}
            aria-label={t('reject')}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--color-danger)', fontSize: 18,
            }}
          >✗</button>
        </>
      )}
    </div>
  );
}
