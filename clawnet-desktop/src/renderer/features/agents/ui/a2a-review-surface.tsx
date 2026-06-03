import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { DialogStatus } from '../../../../shared/domain/dialog';
import { useDialogByConversation, useDialogActions } from '../hooks/use-dialog';
import { useDialogDraft } from '../hooks/use-dialog-draft';
import { useDialogDraftStore } from '../state/dialog-draft-slice';
import { Button } from '../../../components/ui/button';
import { Markdown } from '../../../components/markdown';

/**
 * Unified A2A review surface — replaces the old `AgentDialogControlBar`
 * + `A2AReviewPanel` pair. Sits at the composer's position so an active
 * A2A dialog adds no extra vertical band that crushes the message list.
 *
 * Two display modes (both keyed off `session.status === 'active'`):
 *   - Compact: a single slim status row (status badge · round counter ·
 *     topic · Extend/Terminate). Shown while waiting for a draft. The
 *     normal composer stays visible below it.
 *   - Review: status row + a 3-way source switcher (tag agent / main
 *     assistant / manual) + ONE draft area + an action row. Only ONE
 *     draft is on screen at a time. The composer is hidden — see
 *     `useA2AReviewMode` which ChatContainer uses to gate it.
 *
 * Behavior (source model, refine→LLM, submitResponse IPC) is unchanged
 * from the old panel; only the layout is compacted.
 */
type Source = 'tag' | 'main' | 'manual';

const STATUS_COLOR: Record<DialogStatus, string> = {
  pending_approval: 'var(--color-warning)',
  active: 'var(--color-brand-500)',
  paused: 'var(--color-purple)',
  completed: 'var(--color-success)',
  terminated: 'var(--color-danger)',
};

export function A2AReviewSurface({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation('agent');
  const { data: session } = useDialogByConversation(conversationId);
  // Hooks must run unconditionally — resolve sessionId before any return.
  const sessionId = session?.id ?? '';
  const actions = useDialogActions(sessionId);
  const draft = useDialogDraft(sessionId);
  const clearDraft = useDialogDraftStore((s) => s.clearDraft);

  const [selectedSource, setSelectedSource] = useState<Source>('tag');
  const [refineText, setRefineText] = useState('');
  const [manualText, setManualText] = useState('');
  const [showExtend, setShowExtend] = useState(false);
  const [addRounds, setAddRounds] = useState(5);
  const [showTerminateConfirm, setShowTerminateConfirm] = useState(false);

  if (!session) return null;
  if (session.status === 'pending_approval' || session.status === 'paused') {
    return null;
  }

  if (session.status === 'terminated') {
    return (
      <StatusRow
        tone="danger"
        icon="✗"
        label={t('controlBar.dialogTerminated', { defaultValue: 'Dialog terminated' })}
        reason={session.terminationReason}
        testId="a2a-status-row-terminated"
      />
    );
  }

  if (session.status === 'completed') {
    return (
      <StatusRow
        tone="success"
        icon="✓"
        label={t('controlBar.dialogCompleted', { defaultValue: 'Dialog completed' })}
        testId="a2a-status-row-completed"
      />
    );
  }

  // active — existing rendering flow continues below

  const tagAgentName = session.responderAgent.displayName;
  const tagDraftText = draft?.secondaryDraftText ?? '';
  const mainDraftText = draft?.mainDraftText;
  const draftStatus = draft?.status;
  const hasDraft = tagDraftText.length > 0 || mainDraftText !== undefined;

  const displayRound = Math.floor((session.currentRound + 1) / 2);
  const displayMaxRounds = Math.floor((session.maxRounds + 1) / 2);

  function onConfirmExtend() {
    if (!Number.isFinite(addRounds) || addRounds < 1) return;
    actions.extend.mutate(
      { additionalRounds: addRounds },
      { onSuccess: () => setShowExtend(false) },
    );
  }

  function onConfirmTerminate() {
    actions.terminate.mutate({ reason: 'owner_terminated' });
    setShowTerminateConfirm(false);
  }

  function selectMain() {
    setSelectedSource('main');
    // Lazy-load the main-assistant draft on first selection.
    if (mainDraftText === undefined && !actions.requestMain.isPending) {
      actions.requestMain.mutate();
    }
  }

  function refine() {
    if (!refineText.trim()) return;
    actions.refine.mutate(
      { target: selectedSource === 'main' ? 'main' : 'tag', instruction: refineText.trim() },
      { onSuccess: () => setRefineText('') },
    );
  }

  function submitDraft() {
    const text =
      selectedSource === 'tag'
        ? tagDraftText
        : selectedSource === 'main'
          ? mainDraftText ?? ''
          : manualText;
    if (!text.trim()) return;
    actions.submitResponse.mutate(
      { text },
      {
        onSuccess: () => {
          // Reset the surface once the reply is accepted: clear the
          // typed manual text + refine instruction, drop the consumed
          // draft (→ compact mode until the next round's draft push),
          // and default the next round back to the tag source.
          setManualText('');
          setRefineText('');
          setSelectedSource('tag');
          if (sessionId) clearDraft(sessionId);
        },
      },
    );
  }

  const sendLabel =
    selectedSource === 'tag'
      ? t('dialog.sendTagReply', { name: tagAgentName, defaultValue: `Send via ${tagAgentName}` })
      : selectedSource === 'main'
        ? t('dialog.sendMainReply', { defaultValue: 'Send main draft' })
        : t('dialog.sendManualReply', { defaultValue: 'Send manual reply' });

  const canSubmit =
    !actions.submitResponse.isPending &&
    ((selectedSource === 'tag' && tagDraftText.trim().length > 0) ||
      (selectedSource === 'main' && (mainDraftText ?? '').trim().length > 0) ||
      (selectedSource === 'manual' && manualText.trim().length > 0));

  const statusColor = STATUS_COLOR[session.status];

  return (
    <section
      data-testid="a2a-review-panel"
      style={{
        background: 'var(--color-bg-surface)',
        borderTop: '1px solid var(--color-border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      {/* ── Status row (the slimmed-down control bar) ───────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          minHeight: 32,
          boxSizing: 'border-box',
          borderBottom: hasDraft ? '1px solid var(--color-border-subtle)' : 'none',
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: '2px 6px',
            borderRadius: 4,
            color: statusColor,
            border: `1px solid ${statusColor}`,
            textTransform: 'uppercase',
            flexShrink: 0,
          }}
        >
          {t(`controlBar.status.${session.status}`, { defaultValue: session.status })}
        </span>
        <span
          className="font-mono"
          style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-primary)', flexShrink: 0 }}
        >
          {displayRound}/{displayMaxRounds}
        </span>
        <span
          className="truncate"
          style={{ fontSize: 12, color: 'var(--color-text-secondary)', flex: 1, minWidth: 0 }}
        >
          {session.topic}
        </span>

        {!showExtend && !showTerminateConfirm && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setShowExtend(true)}>
              {t('controlBar.extend', { defaultValue: 'Extend' })}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowTerminateConfirm(true)}
              style={{ color: 'var(--color-danger)' } as CSSProperties}
            >
              {t('controlBar.terminate', { defaultValue: 'Terminate' })}
            </Button>
          </>
        )}

        {showExtend && (
          <>
            <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', flexShrink: 0 }}>
              {t('controlBar.addRoundsPrefix', { defaultValue: 'Add' })}
            </span>
            <input
              type="number"
              min={1}
              value={addRounds}
              onChange={(e) => setAddRounds(parseInt(e.target.value, 10) || 0)}
              style={{
                width: 52,
                padding: '2px 6px',
                fontSize: 12,
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--color-bg-app)',
                color: 'var(--color-text-primary)',
              }}
            />
            <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', flexShrink: 0 }}>
              {t('controlBar.addRoundsSuffix', { defaultValue: 'rounds' })}
            </span>
            <Button size="sm" variant="primary" disabled={actions.extend.isPending} onClick={onConfirmExtend}>
              {t('controlBar.confirm', { defaultValue: 'Confirm' })}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowExtend(false)}>
              {t('controlBar.cancel', { defaultValue: 'Cancel' })}
            </Button>
          </>
        )}

        {showTerminateConfirm && (
          <>
            <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', flexShrink: 0 }}>
              {t('controlBar.confirmTerminateMessage', {
                defaultValue: 'End this dialog now? This cannot be undone.',
              })}
            </span>
            <Button
              size="sm"
              variant="primary"
              disabled={actions.terminate.isPending}
              onClick={onConfirmTerminate}
              style={{ background: 'var(--color-danger)' } as CSSProperties}
            >
              {t('controlBar.confirmTerminate', { defaultValue: 'End dialog' })}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowTerminateConfirm(false)}>
              {t('controlBar.cancel', { defaultValue: 'Cancel' })}
            </Button>
          </>
        )}
      </div>

      {/* ── Review block (only once a draft exists) ─────────────── */}
      {hasDraft && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
          {/* Source switcher — segmented control */}
          <div
            role="tablist"
            style={{
              display: 'flex',
              gap: 4,
              background: 'var(--color-bg-surface-2)',
              borderRadius: 'var(--radius-md)',
              padding: 3,
            }}
          >
            <SourceTab
              label={tagAgentName}
              selected={selectedSource === 'tag'}
              onClick={() => setSelectedSource('tag')}
            />
            <SourceTab
              label={t('dialog.mainAssistant', { defaultValue: 'Main Assistant' })}
              selected={selectedSource === 'main'}
              onClick={selectMain}
            />
            <SourceTab
              label={t('dialog.manualReplyLabel', { defaultValue: 'You' })}
              selected={selectedSource === 'manual'}
              onClick={() => setSelectedSource('manual')}
            />
          </div>

          {/* Single draft area — content depends on selected source */}
          <div data-testid={`a2a-draft-${selectedSource}`} style={draftBoxStyle}>
            {selectedSource === 'manual' ? (
              <textarea
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                rows={3}
                placeholder={t('dialog.manualPlaceholder', { defaultValue: 'Type your reply…' })}
                style={manualTextareaStyle}
              />
            ) : selectedSource === 'main' ? (
              draftStatus === 'generating' || mainDraftText === undefined ? (
                <span style={placeholderStyle}>
                  {t('dialog.generating', { defaultValue: 'Generating…' })}
                </span>
              ) : (
                <Markdown content={mainDraftText} />
              )
            ) : tagDraftText ? (
              <Markdown content={tagDraftText} />
            ) : (
              <span style={placeholderStyle}>
                {t('dialog.waitingForTagDraft', { defaultValue: 'Waiting for draft…' })}
              </span>
            )}
          </div>

          {/* Action row — refine (agent sources only) + Send */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {selectedSource !== 'manual' && (
              <>
                <input
                  type="text"
                  value={refineText}
                  onChange={(e) => setRefineText(e.target.value)}
                  placeholder={t('dialog.refineInstruction', { defaultValue: 'Refine instruction…' })}
                  disabled={draftStatus === 'refining'}
                  style={refineInputStyle}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={refine}
                  disabled={!refineText.trim() || draftStatus === 'refining' || actions.refine.isPending}
                >
                  {t('dialog.refine', { defaultValue: 'Refine' })}
                </Button>
              </>
            )}
            <span style={{ flex: 1 }} />
            <Button variant="primary" onClick={submitDraft} disabled={!canSubmit}>
              {sendLabel}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function StatusRow({
  tone,
  icon,
  label,
  reason,
  testId,
}: {
  tone: 'danger' | 'success';
  icon: string;
  label: string;
  reason?: string | null | undefined;
  testId: string;
}) {
  const bg = tone === 'danger' ? 'var(--color-danger-bg-subtle)' : 'var(--color-success-bg-subtle)';
  const border =
    tone === 'danger' ? 'var(--color-danger-border-subtle)' : 'var(--color-success-border-subtle)';
  const iconColor = tone === 'danger' ? 'var(--color-danger)' : 'var(--color-success)';
  return (
    <div
      data-testid={testId}
      style={{
        padding: '8px 12px',
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 13,
      }}
    >
      <span style={{ color: iconColor }}>{icon}</span>
      <span style={{ color: 'var(--color-text-primary)' }}>{label}</span>
      {reason && (
        <span style={{ marginLeft: 6, color: 'var(--color-text-secondary)' }}>({reason})</span>
      )}
    </div>
  );
}

function SourceTab({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      style={{
        flex: 1,
        padding: '5px 8px',
        fontSize: 12,
        fontWeight: 600,
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        background: selected ? 'var(--color-bg-app)' : 'transparent',
        color: selected ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
        boxShadow: selected ? 'var(--shadow-sm, 0 1px 2px var(--color-scrim))' : 'none',
      }}
    >
      {label}
    </button>
  );
}

const draftBoxStyle: CSSProperties = {
  padding: '8px 10px',
  fontSize: 13,
  background: 'var(--color-bg-surface-2)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--color-text-primary)',
  minHeight: 56,
  maxHeight: 160,
  overflowY: 'auto',
};

const placeholderStyle: CSSProperties = {
  color: 'var(--color-text-muted)',
  fontSize: 12,
};

// Borderless/transparent — the draftBox wrapper provides the frame.
const manualTextareaStyle: CSSProperties = {
  width: '100%',
  fontSize: 13,
  background: 'transparent',
  border: 'none',
  outline: 'none',
  color: 'var(--color-text-primary)',
  resize: 'vertical',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

const refineInputStyle: CSSProperties = {
  flex: 1,
  padding: '6px 10px',
  fontSize: 13,
  background: 'var(--color-bg-surface-2)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--color-text-primary)',
  minWidth: 0,
};
