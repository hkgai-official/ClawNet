import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import type { ChatMessage } from '../../../../../shared/domain/chat';
import { IntentAuthorizationCardDataSchema } from '../../../../../shared/domain/card-data';
import { useIpc } from '../../../../hooks/use-ipc';
import { toastStore } from '../../../../components/toast-overlay';
import {
  useIntentAuthTargetsStore,
  type TargetRuntime,
  type TargetStatus,
} from '../../../agents/state/intent-auth-targets-slice';

interface Props {
  message: ChatMessage;
}

/**
 * Intent authorization card — initiator-side; asks the user to approve/deny
 * before an A2A dialog is created. Ports macOS
 * `RichCardViews.swift:402-545` (IntentAuthorizationCardView). Approval
 * sends a `dialog.intent_authorize` WS envelope via `dialogs.intentAuthorize`
 * (ChatService.swift:1013-1031).
 *
 * Two render modes mirror macOS:
 *  1. `isMainAgent && pending` → red security-warning variant (auto-deny CTA
 *     becomes a disabled "macOS-only" notice).
 *  2. Normal flow → orange variant listing targets with full snake_case
 *     fields per RichCardViews.swift:469,471.
 */
export function IntentAuthorizationCard({ message }: Props) {
  const { t } = useTranslation('chat');
  const ipc = useIpc();
  const qc = useQueryClient();
  const authorize = useMutation({
    mutationFn: (args: { authorizationId: string; approved: boolean }) =>
      ipc('dialogs.intentAuthorize', args),
    // Optimistic card status patch — mirrors macOS
    // ChatEventHandler.updateIntentAuthCardStatus (ChatEventHandler.swift:529-545).
    // The server does not push a refresh for this card (`chat.message.updated`
    // is not emitted on /ws/v1/messages — verified by grep against the
    // server source), so this cache patch is the single source of truth
    // for the post-click UI state.
    onSuccess: (_v, vars) => {
      qc.setQueryData(
        ['chat.messages', message.conversationId],
        (prev: { messages: ChatMessage[]; meta: unknown } | undefined) => {
          const messages = prev?.messages ?? [];
          const nextStatus = vars.approved ? 'approved' : 'denied';
          const next = messages.map((m) => {
            if (m.id !== message.id) return m;
            // The card lives inside `message.content`; patch only the
            // `status` field and leave the rest of the rawData intact.
            const content = (m.content ?? {}) as Record<string, unknown>;
            return { ...m, content: { ...content, status: nextStatus } };
          });
          return { messages: next, meta: prev?.meta ?? null };
        },
      );
    },
    onError: (_e, vars) =>
      toastStore.getState().push({
        message: vars.approved
          ? t('intentApproveFailed', { defaultValue: 'Failed to approve' })
          : t('intentDenyFailed', { defaultValue: 'Failed to deny' }),
        level: 'error',
      }),
  });
  const parsed = IntentAuthorizationCardDataSchema.safeParse(message.content);
  // Slice subscriptions: a single per-component subscription to this auth's
  // entries map means React re-renders whenever any target's runtime within
  // this auth changes (avoids a `useStore`-call-inside-map hook violation).
  // Hoisted above the schema-failure early return so hook order stays stable.
  const initFromIntentAuth = useIntentAuthTargetsStore((s) => s.initFromIntentAuth);
  const markSubmitted = useIntentAuthTargetsStore((s) => s.markSubmitted);
  const parsedAuthorizationId = parsed.success ? parsed.data.authorizationId : undefined;
  const parsedTargets = parsed.success ? parsed.data.targets : undefined;
  const authEntries = useIntentAuthTargetsStore((s) =>
    parsedAuthorizationId ? s.byAuth[parsedAuthorizationId] : undefined,
  );

  // `parsed.data` is re-derived on every render, so `parsedTargets` is a fresh
  // array reference each time. Memoize the mapped payload via a stable
  // serialization key so the effect below doesn't re-run on every render.
  // JSON.stringify is acceptable for the typical 1-5 targets case.
  const memoTargets = useMemo(
    () =>
      parsedTargets?.map((tt) => {
        const out: { userName: string; agentName?: string; topic?: string } = {
          userName: tt.target_user_name ?? '?',
        };
        if (tt.target_agent_name !== undefined) out.agentName = tt.target_agent_name;
        if (tt.topic !== undefined) out.topic = tt.topic;
        return out;
      }),
    // Key on a stable serialization since parsedTargets identity churns each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(parsedTargets)],
  );

  useEffect(() => {
    if (!parsedAuthorizationId || !memoTargets) return;
    initFromIntentAuth({
      authorizationId: parsedAuthorizationId,
      targets: memoTargets,
    });
  }, [parsedAuthorizationId, memoTargets, initFromIntentAuth]);

  if (!parsed.success) {
    // Server can update message.content to a non-IntentAuthorization shape
    // when the auth session is terminated (#4b). Render a soft fallback so
    // the card doesn't visually disappear from history; warn so we can
    // diagnose root cause from logs.
    console.warn('[intent-auth] message content failed to parse, rendering fallback', {
      messageId: message.id,
      contentType: message.contentType,
    });
    return (
      <div
        data-testid="intent-authorization-card"
        style={{
          padding: 12,
          maxWidth: 300,
          background: 'var(--color-bg-overlay)',
          borderRadius: 10,
          border: '1px solid var(--color-border-subtle)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--color-text-secondary)',
          fontSize: 12,
        }}
      >
        <span>🛡</span>
        <span>{t('intentAuthorizationEnded', { defaultValue: 'Authorization session ended' })}</span>
      </div>
    );
  }
  const { authorizationId, agentName, status, isMainAgent, targets } = parsed.data;
  const isPending = status === 'pending';
  const submitting = authorize.isPending;
  // NOTE on what `status` means here: it reflects the USER'S decision
  // (`approved` after clicking Approve, `denied` after clicking Deny, or
  // `pending` if nothing has been clicked yet). It is NOT the outcome
  // of the resulting dialog. macOS `ChatEventHandler.swift:530-545`
  // only updates this field on the local click and never refreshes it
  // when the other party rejects — we mirror that semantic. The
  // recipient's rejection is signalled separately by:
  //   - the per-target pill below (`TargetStatusPill`), patched by
  //     `applyStatusChanged` once dialog.status_change arrives;
  //   - the global toast wired up by `useDialogTerminationToast`;
  //   - the `[System] X rejected the dialog request` text message that
  //     the server pushes into the source conversation.
  // Earlier work tried to override this badge from the targets slice;
  // that conflated "user's authorization action" with "dialog outcome"
  // and made the card claim the user denied when they had actually
  // approved.

  const onApprove = () => {
    markSubmitted(authorizationId);
    authorize.mutate({ authorizationId, approved: true });
  };
  const onDeny = () =>
    authorize.mutate({ authorizationId, approved: false });

  if (isMainAgent && isPending) {
    return (
      <div
        data-testid="intent-authorization-card"
        style={{
          padding: 12,
          maxWidth: 300,
          background: 'var(--color-danger-bg-subtle)',
          borderRadius: 10,
          border: '1px solid var(--color-danger-border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: 'var(--color-danger)' }}>🔒</span>
          <span style={{ fontWeight: 600, fontSize: 13 }}>
            {t('securityReminder', { defaultValue: 'Security notice' })}
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
          {t('mainAgentSecurityNote', {
            defaultValue:
              'A main agent has requested dialog authorization. This is auto-denied for safety.',
          })}
        </div>
        {/* Main-agent variant: macOS shows a single acknowledgement
            button labeled "Understood" that confirms the auto-deny
            (RichCardViews.swift:437). We mirror that here so the wording
            matches user expectations instead of presenting it as an
            active decision. */}
        <ActionRow
          showApprove={false}
          submitting={submitting}
          onApprove={onApprove}
          onDeny={onDeny}
          approveLabel={t('intentApprove', { defaultValue: 'Approve' })}
          denyLabel={t('intentUnderstood', { defaultValue: 'Understood' })}
        />
      </div>
    );
  }

  return (
    <div
      data-testid="intent-authorization-card"
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
          {t('dialogAuthorizationRequest', { defaultValue: 'Authorization request' })}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            padding: '2px 6px',
            borderRadius: 3,
            background:
              status === 'approved'
                ? 'var(--color-success-badge-bg)'
                : status === 'denied'
                ? 'var(--color-danger-badge-bg)'
                : 'var(--color-warning-badge-bg)',
            color:
              status === 'approved'
                ? 'var(--color-success)'
                : status === 'denied'
                ? 'var(--color-danger)'
                : 'var(--color-warning)',
            fontWeight: 600,
          }}
        >
          {t(`intentStatus.${status}`, { defaultValue: status })}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
        {agentName
          ? t('agentWantsToDialog', {
              defaultValue: `${agentName} wants to start a dialog`,
              agentName,
            })
          : t('dialogAuthorizationRequest', { defaultValue: 'Dialog authorization' })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {targets.map((target, i) => {
          const key = `${target.target_user_name ?? '?'}__${target.target_agent_name ?? ''}`;
          const runtime = authEntries?.[key];
          return (
            <div
              key={i}
              style={{
                padding: 6,
                background: 'var(--color-bg-overlay)',
                borderRadius: 6,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 6,
              }}
            >
              <span style={{ color: 'var(--color-purple)' }}>👤</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  {target.target_user_name ?? '?'}
                  {target.target_agent_name && (
                    <span style={{ color: 'var(--color-text-secondary)', fontWeight: 400 }}>
                      {' / '}
                      {target.target_agent_name}
                    </span>
                  )}
                </div>
                {target.contact_tag_display_name && (
                  <span
                    style={{
                      fontSize: 10,
                      padding: '1px 5px',
                      borderRadius: 3,
                      background: 'var(--color-purple-badge-bg)',
                      color: 'var(--color-purple)',
                    }}
                  >
                    {target.contact_tag_display_name}
                  </span>
                )}
                {target.topic && (
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                    {target.topic}
                  </div>
                )}
                {runtime && <TargetStatusPill runtime={runtime} t={t} />}
              </div>
            </div>
          );
        })}
      </div>
      {isPending ? (
        <ActionRow
          showApprove
          submitting={submitting}
          onApprove={onApprove}
          onDeny={onDeny}
          approveLabel={t('intentApprove', { defaultValue: 'Approve' })}
          denyLabel={t('intentDeny', { defaultValue: 'Deny' })}
        />
      ) : (
        <PostActionResultRow status={status} t={t} />
      )}
    </div>
  );
}

interface PostActionResultRowProps {
  status: string;
  t: TFunction;
}

function PostActionResultRow({ status, t }: PostActionResultRowProps) {
  if (status !== 'approved' && status !== 'denied') return null;
  const isApproved = status === 'approved';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px',
        borderRadius: 6,
        background: isApproved
          ? 'var(--color-success-badge-bg)'
          : 'var(--color-danger-badge-bg)',
        color: isApproved ? 'var(--color-success)' : 'var(--color-danger)',
        fontWeight: 600,
        fontSize: 13,
      }}
    >
      <span>{isApproved ? '✓' : '✗'}</span>
      <span>
        {isApproved
          ? t('intentAuthorizedConfirm', { defaultValue: 'You authorized this request' })
          : t('intentDeniedConfirm', { defaultValue: 'You denied this request' })}
      </span>
    </div>
  );
}

interface ActionRowProps {
  showApprove: boolean;
  submitting: boolean;
  onApprove: () => void;
  onDeny: () => void;
  approveLabel: string;
  denyLabel: string;
}

interface StatusMeta {
  icon: string;
  key: string;
  fallback: string;
  tone: string;
}

const STATUS_META: Partial<Record<TargetStatus, StatusMeta>> = {
  submitted:   { icon: '⏳', key: 'submitted',   fallback: 'Submitted',   tone: 'text-secondary' },
  pending:     { icon: '⏳', key: 'pending',     fallback: 'Pending',     tone: 'text-secondary' },
  accepted:    { icon: '✅', key: 'accepted',    fallback: 'Accepted',    tone: 'success' },
  in_progress: { icon: '🔵', key: 'inProgress',  fallback: 'In dialog',   tone: 'brand-500' },
  completed:   { icon: '✓',  key: 'completed',   fallback: 'Completed',   tone: 'success' },
  rejected:    { icon: '❌', key: 'rejected',    fallback: 'Rejected',    tone: 'danger' },
};

function TargetStatusPill({ runtime, t }: { runtime: TargetRuntime; t: TFunction }) {
  const meta = STATUS_META[runtime.status];
  if (!meta) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
      <span aria-hidden>{meta.icon}</span>
      <span style={{ fontSize: 11, color: `var(--color-${meta.tone})` }}>
        {t(`intentAuthStatus.${meta.key}`, { defaultValue: meta.fallback })}
        {runtime.status === 'in_progress' &&
          typeof runtime.currentRound === 'number' &&
          typeof runtime.maxRounds === 'number' && (
            <span style={{ marginLeft: 4 }}>
              {t('intentAuthRoundLabel', {
                defaultValue: '(round {{round}}/{{max}})',
                round: runtime.currentRound,
                max: runtime.maxRounds,
              })}
            </span>
          )}
      </span>
    </div>
  );
}

function ActionRow({
  showApprove,
  submitting,
  onApprove,
  onDeny,
  approveLabel,
  denyLabel,
}: ActionRowProps) {
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
      <button
        type="button"
        data-testid="intent-deny-btn"
        onClick={onDeny}
        disabled={submitting}
        style={{
          padding: '4px 10px',
          fontSize: 12,
          borderRadius: 6,
          border: '1px solid var(--color-border)',
          background: 'var(--color-bg-overlay)',
          color: 'var(--color-text-primary)',
          cursor: submitting ? 'wait' : 'pointer',
          opacity: submitting ? 0.6 : 1,
        }}
      >
        {denyLabel}
      </button>
      {showApprove && (
        <button
          type="button"
          data-testid="intent-approve-btn"
          onClick={onApprove}
          disabled={submitting}
          style={{
            padding: '4px 10px',
            fontSize: 12,
            borderRadius: 6,
            border: 'none',
            background: 'var(--color-success)',
            color: 'var(--color-on-success)',
            cursor: submitting ? 'wait' : 'pointer',
            opacity: submitting ? 0.6 : 1,
            fontWeight: 600,
          }}
        >
          {approveLabel}
        </button>
      )}
    </div>
  );
}
