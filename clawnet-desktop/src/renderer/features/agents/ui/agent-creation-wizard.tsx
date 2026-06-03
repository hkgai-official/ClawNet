import { useTranslation } from 'react-i18next';
import { useAgentWizardStore } from '../state/agent-wizard-slice';
import { useCreateAgent, useUpdateAgent } from '../hooks/use-agent-mutations';
import { Button } from '../../../components/ui/button';
import { Sheet, SheetHeader, SheetBody, SheetFooter } from '../../../components/ui/sheet';
import { toastStore } from '../../../components/toast-overlay';
import { StepBasics } from './wizard/step-basics';
import { StepCapabilities } from './wizard/step-capabilities';
import { StepPromptRules } from './wizard/step-prompt-rules';
import { StepPermissions } from './wizard/step-permissions';

const STEP_COUNT = 4;

export function AgentCreationWizard() {
  const { t } = useTranslation('agent');
  const open = useAgentWizardStore((s) => s.open);
  const mode = useAgentWizardStore((s) => s.mode);
  const step = useAgentWizardStore((s) => s.step);
  const draft = useAgentWizardStore((s) => s.draft);
  const next = useAgentWizardStore((s) => s.next);
  const prev = useAgentWizardStore((s) => s.prev);
  const close = useAgentWizardStore((s) => s.close);
  const editingAgentId = useAgentWizardStore((s) => s.editingAgentId);
  const selectedTagId = useAgentWizardStore((s) => s.selectedTagId);
  const create = useCreateAgent();
  const update = useUpdateAgent();

  const onSubmit = () => {
    if (!draft) return;
    if (mode === 'create') {
      create.mutate(
        {
          config: draft,
          ...(selectedTagId ? { tagId: selectedTagId, tagRole: 'delegate' } : {}),
        },
        {
          onSuccess: close,
          onError: () => toastStore.getState().push({ message: t('wizard.createFailed'), level: 'error' }),
        },
      );
    } else if (mode === 'edit' && editingAgentId) {
      update.mutate(
        { id: editingAgentId, config: draft },
        {
          onSuccess: close,
          onError: () => toastStore.getState().push({ message: t('wizard.updateFailed'), level: 'error' }),
        },
      );
    }
  };

  if (!open || !draft) {
    // Render a closed Sheet so the primitive's hooks (focus restore etc.)
    // tear down cleanly; passing `open={false}` short-circuits the render
    // and avoids a portal mount.
    return <Sheet open={false} onClose={close} size="md">{null}</Sheet>;
  }

  const stepLabels: string[] = [
    t('wizard.basics'),
    t('wizard.capabilities'),
    t('wizard.promptRules'),
    t('wizard.permissions'),
  ];
  const isLastStep = step === STEP_COUNT - 1;
  const canAdvance = step === 0 ? draft.displayName.trim().length > 0 : true;

  return (
    <Sheet
      open={open}
      onClose={close}
      size="md"
      testId="agent-creation-wizard"
      closeOnScrim={false}
    >
      <SheetHeader onClose={close}>
        {mode === 'create' ? t('wizard.newAgent') : t('wizard.editAgent')}
      </SheetHeader>
      <SheetBody>
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
          {t('wizard.step', { current: step + 1, total: STEP_COUNT })} · {stepLabels[step]}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {Array.from({ length: STEP_COUNT }, (_, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: 3,
                borderRadius: 2,
                background: i <= step ? 'var(--color-info)' : 'var(--color-bg-surface-2)',
              }}
            />
          ))}
        </div>

        <div style={{ flex: 1, minHeight: 200 }}>
          {step === 0 && <StepBasics />}
          {step === 1 && <StepCapabilities />}
          {step === 2 && <StepPromptRules />}
          {step === 3 && <StepPermissions />}
        </div>
      </SheetBody>
      <SheetFooter>
        <Button size="sm" variant="ghost" type="button" onClick={close}>{t('wizard.cancel')}</Button>
        {step > 0 && <Button size="sm" variant="secondary" type="button" onClick={prev}>{t('wizard.back')}</Button>}
        {!isLastStep && (
          <Button size="sm" variant="primary" type="button" disabled={!canAdvance} onClick={next}>
            {t('wizard.next')}
          </Button>
        )}
        {isLastStep && (
          <Button
            size="sm"
            variant="primary"
            type="button"
            disabled={create.isPending || update.isPending || !canAdvance}
            onClick={onSubmit}
          >
            {mode === 'create' ? t('wizard.create') : t('wizard.save')}
          </Button>
        )}
      </SheetFooter>
    </Sheet>
  );
}
