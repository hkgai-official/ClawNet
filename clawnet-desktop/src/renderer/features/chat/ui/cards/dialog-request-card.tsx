import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '../../../../../shared/domain/chat';
import { DialogRequestCardDataSchema } from '../../../../../shared/domain/card-data';

interface Props {
  message: ChatMessage;
}

/**
 * Dialog request card — initiator-side, status-only display (no actions).
 * Ports macOS `RichCardViews.swift:183-283` (DialogRequestCardView).
 *
 * The target-owner skip rule (hide for users seeing their own dialog request)
 * is enforced by the parent MessageBubble before rendering — see Task 14.
 */
export function DialogRequestCard({ message }: Props) {
  const { t } = useTranslation('chat');
  const parsed = DialogRequestCardDataSchema.safeParse(message.content);
  if (!parsed.success) {
    return (
      <div
        data-testid="dialog-request-card"
        style={{ padding: 8, fontSize: 11, color: 'var(--color-danger)' }}
      >
        [dialog_request payload invalid]
      </div>
    );
  }
  const { topic, status, myAgent, targetAgent, contactTag } = parsed.data;

  const badge = (() => {
    switch (status) {
      case 'confirmed':
        return {
          bg: 'var(--color-success-badge-bg)',
          fg: 'var(--color-success)',
          text: t('dialogConfirmed', { defaultValue: 'Confirmed' }),
          icon: '✓',
        };
      case 'completed':
        return {
          bg: 'var(--color-success-badge-bg)',
          fg: 'var(--color-success)',
          text: t('dialogCompleted', { defaultValue: 'Completed' }),
          icon: '✓',
        };
      case 'cancelled':
        return {
          bg: 'var(--color-danger-badge-bg)',
          fg: 'var(--color-danger)',
          text: t('dialogRejected', { defaultValue: 'Rejected' }),
          icon: '✗',
        };
      default:
        return {
          bg: 'var(--color-warning-badge-bg)',
          fg: 'var(--color-warning)',
          text: t('waitingAuth', { defaultValue: 'Waiting…' }),
          icon: '⏳',
        };
    }
  })();

  return (
    <div
      data-testid="dialog-request-card"
      style={{
        padding: 12,
        maxWidth: 280,
        background: 'var(--color-info-bg-subtle)',
        borderRadius: 10,
        border: '1px solid var(--color-info-border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: 'var(--color-info)' }}>💬</span>
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          {t('dialogRequestSent', { defaultValue: 'Dialog request sent' })}
        </span>
      </div>
      {topic && (
        <div>
          <div style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>
            {t('topic', { defaultValue: 'Topic' })}
          </div>
          <div
            style={{
              fontSize: 12,
              padding: 8,
              background: 'var(--color-bg-overlay)',
              borderRadius: 6,
            }}
          >
            {topic}
          </div>
        </div>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          flexWrap: 'wrap',
          fontSize: 12,
        }}
      >
        <span style={{ fontWeight: 600, color: 'var(--color-info)' }}>
          {myAgent?.displayName ?? '—'}
        </span>
        <span style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>→</span>
        <span style={{ fontWeight: 600, color: 'var(--color-purple)' }}>
          {targetAgent?.displayName ?? '—'}
        </span>
        {contactTag?.displayName && (
          <span
            style={{
              fontSize: 10,
              padding: '2px 6px',
              background: 'var(--color-purple-badge-bg)',
              color: 'var(--color-purple)',
              borderRadius: 3,
            }}
          >
            {contactTag.displayName}
          </span>
        )}
      </div>
      <div
        style={{
          display: 'inline-flex',
          alignSelf: 'flex-start',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          borderRadius: 4,
          background: badge.bg,
          color: badge.fg,
          fontSize: 11,
          fontWeight: 600,
        }}
      >
        <span>{badge.icon}</span>
        <span>{badge.text}</span>
      </div>
    </div>
  );
}
