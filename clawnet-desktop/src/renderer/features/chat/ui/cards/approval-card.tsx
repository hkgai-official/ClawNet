import { useTranslation } from 'react-i18next';
import { Button } from '../../../../components/ui/button';
import type { ChatMessage } from '../../../../../shared/domain/chat';

interface Props {
  message: ChatMessage;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
}

const STATUS_STYLE: Record<string, { fg: string; bg: string }> = {
  pending: { fg: 'var(--color-warning)', bg: 'var(--color-warning-badge-bg)' },
  approved: { fg: 'var(--color-success)', bg: 'var(--color-success-badge-bg)' },
  rejected: { fg: 'var(--color-danger)', bg: 'var(--color-danger-badge-bg)' },
  modified: { fg: 'var(--color-info)', bg: 'var(--color-info-badge-bg)' },
};

/**
 * Approval request card.
 *
 * macOS `MessageBubble.swift:264-273` synthesizes `ApprovalRequest` from
 * `content.id` / `content.name` / `content.text` (NOT from rawData), always
 * starting with `status='pending'`. We mirror that: read `content.id/name/text`,
 * use `content.status` if server provides one, default 'pending' otherwise.
 *
 * Action callbacks are optional — if not wired by the parent, the card
 * renders without action buttons even while pending (degrades to read-only).
 *
 * Ported from RichCardViews.swift:6-70 (ApprovalCardView).
 */
export function ApprovalCard({ message, onApprove, onReject }: Props) {
  const { t } = useTranslation('chat');
  const c = message.content as {
    id?: string | null;
    name?: string | null;
    text?: string | null;
    status?: string | null;
  };
  const status = c.status ?? 'pending';
  const id = c.id ?? message.id;
  const style = STATUS_STYLE[status] ?? STATUS_STYLE.pending;
  const canAct = status === 'pending' && (onApprove !== undefined || onReject !== undefined);

  return (
    <div
      data-testid="approval-card"
      style={{
        padding: 12,
        maxWidth: 300,
        background: 'var(--color-bg-overlay)',
        borderRadius: 10,
        border: '1px solid var(--color-border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: 'var(--color-warning)' }}>🛡</span>
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          {t('approvalRequest', { defaultValue: 'Approval' })}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            fontWeight: 600,
            color: style!.fg,
            background: style!.bg,
            padding: '2px 6px',
            borderRadius: 3,
          }}
        >
          {t(`approvalStatus.${status}`, { defaultValue: status })}
        </span>
      </div>
      {c.name && (
        <div
          style={{
            fontWeight: 600,
            fontSize: 12,
            color: 'var(--color-text-secondary)',
          }}
        >
          {c.name}
        </div>
      )}
      {c.text && <div style={{ fontSize: 13 }}>{c.text}</div>}
      {canAct && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {onReject && (
            <Button size="sm" variant="secondary" onClick={() => onReject(id)}>
              {t('reject', { defaultValue: 'Reject' })}
            </Button>
          )}
          {onApprove && (
            <Button size="sm" variant="primary" onClick={() => onApprove(id)}>
              {t('approve', { defaultValue: 'Approve' })}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
