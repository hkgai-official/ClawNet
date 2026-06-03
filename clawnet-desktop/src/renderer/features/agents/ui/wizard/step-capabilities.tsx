import { useTranslation } from 'react-i18next';
import { useAgentWizardStore } from '../../state/agent-wizard-slice';
import type { AgentCapability, ExecutionMode, ProactiveIntensity } from '../../../../../shared/domain/agent';

const CAPS: AgentCapability[] = [
  'file_processing', 'web_search', 'code_execution', 'data_analysis', 'scheduling',
  'email_access', 'calendar_access', 'document_editing', 'image_generation', 'translation',
];
const EXEC_MODES: ExecutionMode[] = ['local', 'cloud', 'hybrid'];
const INTENSITIES: ProactiveIntensity[] = ['off', 'low', 'medium', 'high'];

export function StepCapabilities() {
  const { t } = useTranslation('agent');
  const draft = useAgentWizardStore((s) => s.draft);
  const update = useAgentWizardStore((s) => s.updateDraft);
  if (!draft) return null;

  const toggleCap = (c: AgentCapability) => {
    const cur = new Set(draft.capabilities);
    if (cur.has(c)) cur.delete(c); else cur.add(c);
    update({ capabilities: [...cur] });
  };

  const pillStyle = (selected: boolean) => ({
    padding: '4px 10px',
    fontSize: 12,
    background: selected ? 'var(--color-info-bg-subtle)' : 'var(--color-bg-surface-2)',
    border: '1px solid',
    borderColor: selected ? 'var(--color-info)' : 'var(--color-border-subtle)',
    borderRadius: 999,
    cursor: 'pointer',
    color: 'var(--color-text-primary)',
  });
  const modeStyle = (selected: boolean) => ({
    ...pillStyle(selected),
    borderRadius: 'var(--radius-md)' as const,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section>
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
          {t('wizard.capabilities')}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {CAPS.map((c) => {
            const selected = draft.capabilities.includes(c);
            return (
              <button
                key={c}
                type="button"
                data-testid={`wizard-cap-${c}`}
                onClick={() => toggleCap(c)}
                style={pillStyle(selected)}
              >
                {t(`capability.${c}`)}
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
          {t('wizard.executionMode')}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {EXEC_MODES.map((m) => {
            const selected = draft.executionMode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => update({ executionMode: m })}
                style={modeStyle(selected)}
              >{t(`executionMode.${m}`)}</button>
            );
          })}
        </div>
      </section>

      <section>
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
          {t('wizard.proactiveIntensity')}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {INTENSITIES.map((i) => {
            const selected = draft.proactiveIntensity === i;
            return (
              <button
                key={i}
                type="button"
                onClick={() => update({ proactiveIntensity: i })}
                style={modeStyle(selected)}
              >{t(`intensity.${i}`)}</button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
