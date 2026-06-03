import { useState, type CSSProperties } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAgents, useContactableAgents } from '../hooks/use-agents';
import { useGroupStore } from '../../chat/state/group-slice';
import { useChatStore } from '../../chat/state/chat-slice';
import { useIpc } from '../../../hooks/use-ipc';
import { Button } from '../../../components/ui/button';
import { Sheet, SheetHeader, SheetBody, SheetFooter } from '../../../components/ui/sheet';
import { toastStore } from '../../../components/toast-overlay';
import type { Agent } from '../../../../shared/domain/agent';

/**
 * 3-step wizard for initiating an Agent-to-Agent dialog session. 1:1 port
 * of macOS AgentDialogWizard.swift:
 *   1. Pick one of MY agents (initiator)
 *   2. Pick a contactable agent (responder) — filtered to exclude my pick
 *   3. Configure topic (textarea) + maxRounds (1-50, slider + number)
 *
 * On Start Dialog: calls `dialogs.create` IPC; if the returned session
 * carries a conversationId, sets it as active so the chat pane jumps
 * straight to the new dialog. Closes the wizard regardless.
 */
export function AgentDialogWizard() {
  const { t } = useTranslation('agent');
  const open = useGroupStore((s) => s.agentDialogWizardOpen);
  const close = useGroupStore((s) => s.closeAgentDialogWizard);
  const ipc = useIpc();
  const setActive = useChatStore((s) => s.setActiveConversation);
  const myAgents = useAgents();
  const contactable = useContactableAgents();

  const [step, setStep] = useState(1);
  const [myAgent, setMyAgent] = useState<Agent | null>(null);
  const [targetAgent, setTargetAgent] = useState<Agent | null>(null);
  const [topic, setTopic] = useState('');
  const [maxRounds, setMaxRounds] = useState(5);

  const createDialog = useMutation({
    mutationFn: (vars: {
      initiatorAgentId: string;
      responderAgentId: string;
      topic: string;
      maxRounds: number;
    }) => ipc('dialogs.create', vars),
  });

  const reset = () => {
    setStep(1);
    setMyAgent(null);
    setTargetAgent(null);
    setTopic('');
    setMaxRounds(5);
  };

  const onClose = () => {
    reset();
    close();
  };

  const onStart = () => {
    if (!myAgent || !targetAgent || !topic.trim()) return;
    createDialog.mutate(
      {
        initiatorAgentId: myAgent.id,
        responderAgentId: targetAgent.id,
        topic: topic.trim(),
        maxRounds,
      },
      {
        onSuccess: (session) => {
          if (session.conversationId) setActive(session.conversationId);
          onClose();
        },
        onError: () =>
          toastStore.getState().push({
            message: t('dialogWizard.createFailed', {
              defaultValue: 'Failed to start dialog',
            }),
            level: 'error',
          }),
      },
    );
  };

  const canAdvance =
    (step === 1 && !!myAgent) ||
    (step === 2 && !!targetAgent) ||
    (step === 3 && topic.trim().length > 0);

  const targetCandidates = (contactable.data ?? []).filter(
    (a) => a.id !== myAgent?.id,
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="md"
      testId="agent-dialog-wizard"
      closeOnScrim={false}
    >
      <SheetHeader onClose={onClose}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1 }}>
            {t('dialogWizard.title', { defaultValue: 'Start Agent Dialog' })}
          </span>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 400 }}>
            {t('dialogWizard.stepOf', {
              current: step,
              total: 3,
              defaultValue: 'Step {{current}} of {{total}}',
            })}
          </span>
        </div>
      </SheetHeader>
      <SheetBody>
        {/* Step progress bars */}
        <div style={{ display: 'flex', gap: 4 }}>
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              style={{
                flex: 1,
                height: 3,
                borderRadius: 2,
                background:
                  s <= step ? 'var(--color-brand-500)' : 'var(--color-border-subtle)',
              }}
            />
          ))}
        </div>

        <div style={{ flex: 1, minHeight: 0 }}>
          {step === 1 && (
            <StepPickAgent
              title={t('dialogWizard.selectYourAgent', {
                defaultValue: 'Select your agent',
              })}
              description={t('dialogWizard.selectYourAgentDescription', {
                defaultValue: 'Which of your agents should initiate this dialog?',
              })}
              agents={myAgents.data ?? []}
              loading={myAgents.isLoading}
              selectedId={myAgent?.id ?? null}
              emptyMessage={t('dialogWizard.noAgents', {
                defaultValue: 'No agents yet. Create one first.',
              })}
              onSelect={setMyAgent}
            />
          )}

          {step === 2 && (
            <StepPickAgent
              title={t('dialogWizard.selectTargetAgent', {
                defaultValue: 'Select target agent',
              })}
              description={t('dialogWizard.selectTargetAgentDescription', {
                defaultValue: 'Which agent should respond to your initiator?',
              })}
              agents={targetCandidates}
              loading={contactable.isLoading}
              selectedId={targetAgent?.id ?? null}
              emptyMessage={t('dialogWizard.noContactableAgents', {
                defaultValue: 'No other agents available to dialog with.',
              })}
              onSelect={setTargetAgent}
            />
          )}

          {step === 3 && myAgent && targetAgent && (
            <StepConfigure
              myAgent={myAgent}
              targetAgent={targetAgent}
              topic={topic}
              setTopic={setTopic}
              maxRounds={maxRounds}
              setMaxRounds={setMaxRounds}
              t={t}
            />
          )}
        </div>
      </SheetBody>
      <SheetFooter>
        {step > 1 && (
          <Button size="sm" variant="ghost" onClick={() => setStep(step - 1)}>
            {t('dialogWizard.previousStep', { defaultValue: 'Back' })}
          </Button>
        )}
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t('dialogWizard.cancel', { defaultValue: 'Cancel' })}
        </Button>
        {step < 3 ? (
          <Button
            size="sm"
            variant="primary"
            disabled={!canAdvance}
            onClick={() => setStep(step + 1)}
          >
            {t('dialogWizard.nextStep', { defaultValue: 'Next' })}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            disabled={!canAdvance || createDialog.isPending}
            onClick={onStart}
          >
            {t('dialogWizard.startDialog', { defaultValue: 'Start Dialog' })}
          </Button>
        )}
      </SheetFooter>
    </Sheet>
  );
}

function StepPickAgent({
  title,
  description,
  agents,
  loading,
  selectedId,
  emptyMessage,
  onSelect,
}: {
  title: string;
  description: string;
  agents: Agent[];
  loading: boolean;
  selectedId: string | null;
  emptyMessage: string;
  onSelect: (a: Agent) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)' }}>
        {title}
      </span>
      <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
        {description}
      </span>
      {loading ? (
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>…</span>
      ) : agents.length === 0 ? (
        <span style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '24px 0' }}>
          {emptyMessage}
        </span>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {agents.map((a) => (
            <li key={a.id}>
              <AgentRow agent={a} selected={selectedId === a.id} onSelect={() => onSelect(a)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AgentRow({
  agent,
  selected,
  onSelect,
}: {
  agent: Agent;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`wizard-agent-${agent.id}`}
      onClick={onSelect}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px',
        background: selected
          ? 'var(--color-bg-surface-2)'
          : 'var(--color-bg-app)',
        border: `${selected ? 2 : 1}px solid ${
          selected ? 'var(--color-brand-500)' : 'var(--color-border-subtle)'
        }`,
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <div
        aria-hidden
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: 'var(--color-purple-badge-bg)',
          color: 'var(--color-purple)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        {agent.displayName.slice(0, 1).toUpperCase()}
      </div>
      <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
          {agent.displayName}
        </span>
        {agent.description && (
          <span
            className="truncate"
            style={{ fontSize: 11, color: 'var(--color-text-muted)' }}
          >
            {agent.description}
          </span>
        )}
      </div>
      {selected && (
        <span
          aria-hidden
          style={{
            color: 'var(--color-brand-500)',
            fontSize: 16,
            flexShrink: 0,
          }}
        >
          ✓
        </span>
      )}
    </button>
  );
}

function StepConfigure({
  myAgent,
  targetAgent,
  topic,
  setTopic,
  maxRounds,
  setMaxRounds,
  t,
}: {
  myAgent: Agent;
  targetAgent: Agent;
  topic: string;
  setTopic: (s: string) => void;
  maxRounds: number;
  setMaxRounds: (n: number) => void;
  t: ReturnType<typeof useTranslation<'agent'>>['t'];
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)' }}>
        {t('dialogWizard.dialogSettings', { defaultValue: 'Dialog settings' })}
      </span>

      {/* Agent preview */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: 12,
          background: 'var(--color-bg-surface-2)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <AgentPreviewBadge agent={myAgent} label={t('dialogWizard.yourAgent', { defaultValue: 'Your agent' })} />
        <span style={{ color: 'var(--color-text-muted)', fontSize: 16 }} aria-hidden>→</span>
        <AgentPreviewBadge agent={targetAgent} label={t('dialogWizard.targetAgent', { defaultValue: 'Target' })} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>
          {t('dialogWizard.dialogTopic', { defaultValue: 'Dialog topic' })}
        </label>
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          rows={3}
          placeholder={t('dialogWizard.dialogTopicPlaceholder', {
            defaultValue: 'What should the agents discuss?',
          })}
          style={textareaStyle}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>
            {t('dialogWizard.maxRounds', { defaultValue: 'Max rounds' })}
          </label>
          <input
            type="number"
            min={1}
            max={50}
            value={maxRounds}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!Number.isFinite(v)) return;
              setMaxRounds(Math.min(50, Math.max(1, v)));
            }}
            style={{
              width: 56,
              padding: '4px 8px',
              fontSize: 13,
              textAlign: 'center',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-bg-app)',
              color: 'var(--color-text-primary)',
            }}
          />
        </div>
        <input
          type="range"
          min={1}
          max={50}
          step={1}
          value={maxRounds}
          onChange={(e) => setMaxRounds(parseInt(e.target.value, 10))}
          style={{ width: '100%' }}
        />
      </div>
    </div>
  );
}

function AgentPreviewBadge({ agent, label }: { agent: Agent; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}>
      <div
        aria-hidden
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: 'var(--color-purple-badge-bg)',
          color: 'var(--color-purple)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {agent.displayName.slice(0, 1).toUpperCase()}
      </div>
      <span
        className="truncate"
        style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', maxWidth: '100%' }}
      >
        {agent.displayName}
      </span>
      <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{label}</span>
    </div>
  );
}

const textareaStyle: CSSProperties = {
  padding: '8px 10px',
  fontSize: 13,
  background: 'var(--color-bg-surface-2)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--color-text-primary)',
  resize: 'vertical',
  boxSizing: 'border-box',
  width: '100%',
};
