import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../../components/ui/button';
import { toastStore } from '../../../../components/toast-overlay';
import { useDialogActions } from '../../../agents/hooks/use-dialog';
import type { ChatMessage } from '../../../../../shared/domain/chat';
import { DialogApprovalCardDataSchema } from '../../../../../shared/domain/card-data';

interface Props {
  message: ChatMessage;
}

/**
 * Dialog approval card — responder-side; offers approve/reject when pending.
 * Ports macOS `RichCardViews.swift:287-398` (DialogApprovalCardView).
 *
 * The initiator-owner skip rule (hide the card for the user who issued the
 * dialog request) is enforced by the parent MessageBubble before rendering
 * — see Task 14. Action callbacks flow through `useDialogActions(sessionId)`,
 * which posts `dialogs.approve` IPC (wired from P1E governance work).
 */
export function DialogApprovalCard({ message }: Props) {
  const { t } = useTranslation('chat');
  const qc = useQueryClient();
  const parsed = DialogApprovalCardDataSchema.safeParse(message.content);
  // Hooks must run unconditionally; resolve sessionId before parse-success check.
  const sessionId =
    parsed.success && parsed.data.sessionId !== undefined ? parsed.data.sessionId : '';
  const actions = useDialogActions(sessionId);
  const [pendingIntent, setPendingIntent] = useState<'approve' | 'reject' | null>(null);
  const submitting = actions.approve.isPending ? pendingIntent : null;

  // Optimistic status patch — mirrors the IntentAuthorizationCard pattern.
  // Server does NOT push `chat.message.updated` to refresh this card's
  // `content.status` (verified: 0 emits in clawnet-server). Without
  // the patch, after a successful POST /approve the buttons stay
  // visible because `isPending` is still true (it reads from
  // message.content.status, not from session state). The user clicks
  // again, the second POST hits a 500 because the server now sees
  // `session.status: active` and treats the second call as a
  // conflicting decision (`approve_session` line 647). Patch the
  // message.content.status locally on success so `canAct` flips false
  // and the buttons hide.
  const patchCardStatus = (next: 'approved' | 'rejected') => {
    qc.setQueryData(
      ['chat.messages', message.conversationId],
      (prev: { messages: ChatMessage[]; meta: unknown } | undefined) => {
        const messages = prev?.messages ?? [];
        const updated = messages.map((m) => {
          if (m.id !== message.id) return m;
          const content = (m.content ?? {}) as Record<string, unknown>;
          return { ...m, content: { ...content, status: next } };
        });
        return { messages: updated, meta: prev?.meta ?? null };
      },
    );
  };

  const onClickApprove = () => {
    if (submitting) return;
    setPendingIntent('approve');
    actions.approve.mutate(
      { approved: true },
      {
        onSuccess: () => patchCardStatus('approved'),
        onError: () =>
          toastStore.getState().push({
            message: t('dialogApproveFailed', { defaultValue: 'Failed to authorize dialog' }),
            level: 'error',
          }),
        onSettled: () => setPendingIntent(null),
      },
    );
  };
  const onClickReject = () => {
    if (submitting) return;
    setPendingIntent('reject');
    actions.approve.mutate(
      { approved: false },
      {
        onSuccess: () => patchCardStatus('rejected'),
        onError: () =>
          toastStore.getState().push({
            message: t('dialogRejectFailed', { defaultValue: 'Failed to reject dialog' }),
            level: 'error',
          }),
        onSettled: () => setPendingIntent(null),
      },
    );
  };

  if (!parsed.success) {
    return (
      <div
        data-testid="dialog-approval-card"
        style={{ padding: 8, fontSize: 11, color: 'var(--color-danger)' }}
      >
        [dialog_approval payload invalid]
      </div>
    );
  }
  const { topic, status, initiatorAgent, initiatorOwner, myAgent, contactTag } = parsed.data;
  const isPending = status === 'pending';
  const isApproved = status === 'approved' || status === 'completed';
  const canAct = isPending && Boolean(sessionId);

  return (
    <div
      data-testid="dialog-approval-card"
      style={{
        padding: 12,
        maxWidth: 300,
        background: 'var(--color-warning-bg-subtle)',
        borderRadius: 10,
        border: '1px solid var(--color-warning-border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: 'var(--color-warning)' }}>🛡</span>
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          {t('dialogAuthRequest', { defaultValue: 'Dialog authorization request' })}
        </span>
        {contactTag?.displayName && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 10,
              padding: '2px 6px',
              background: 'var(--color-warning-badge-bg)',
              color: 'var(--color-warning)',
              borderRadius: 3,
            }}
          >
            {contactTag.displayName}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
        <InfoRow
          label={t('initiator', { defaultValue: 'Initiator' })}
          value={`${initiatorOwner?.displayName ?? '—'} · ${initiatorAgent?.displayName ?? '—'}`}
        />
        {topic && <InfoRow label={t('topic', { defaultValue: 'Topic' })} value={topic} />}
        <InfoRow
          label={t('myAgent', { defaultValue: 'My agent' })}
          value={myAgent?.displayName ?? '—'}
        />
      </div>

      {canAct && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button
            size="sm"
            variant="secondary"
            disabled={submitting !== null}
            style={{ opacity: submitting === 'reject' ? 0.6 : 1 }}
            onClick={onClickReject}
          >
            ✗{' '}
            {submitting === 'reject'
              ? t('rejecting', { defaultValue: 'Rejecting…' })
              : t('reject', { defaultValue: 'Reject' })}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={submitting !== null}
            style={{ opacity: submitting === 'approve' ? 0.6 : 1 }}
            onClick={onClickApprove}
          >
            ✓{' '}
            {submitting === 'approve'
              ? t('authorizing', { defaultValue: 'Authorizing…' })
              : t('authorizeDialog', { defaultValue: 'Authorize' })}
          </Button>
        </div>
      )}
      {!isPending && (
        <div
          style={{
            display: 'inline-flex',
            alignSelf: 'flex-start',
            alignItems: 'center',
            gap: 4,
            padding: '4px 8px',
            borderRadius: 4,
            background: isApproved ? 'var(--color-success-badge-bg)' : 'var(--color-danger-badge-bg)',
            color: isApproved ? 'var(--color-success)' : 'var(--color-danger)',
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {isApproved ? '✓' : '✗'}{' '}
          {isApproved
            ? t('authorizedInProgress', { defaultValue: 'Authorized' })
            : t('rejected', { defaultValue: 'Rejected' })}
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
      <span
        style={{
          width: 55,
          textAlign: 'right',
          fontSize: 10,
          color: 'var(--color-text-secondary)',
        }}
      >
        {label}
      </span>
      <span style={{ flex: 1, fontSize: 12 }}>{value}</span>
    </div>
  );
}
