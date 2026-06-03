import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentWizardStore } from '../../state/agent-wizard-slice';
import { Button } from '../../../../components/ui/button';
import type { ProactiveRule } from '../../../../../shared/domain/agent';

function emptyRule(): ProactiveRule {
  return {
    id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    trigger: '',
    condition: '',
    action: '',
    enabled: true,
  };
}

export function StepPromptRules() {
  const { t } = useTranslation('agent');
  const draft = useAgentWizardStore((s) => s.draft);
  const update = useAgentWizardStore((s) => s.updateDraft);
  if (!draft) return null;

  const rules = draft.proactiveRules ?? [];
  const updateRule = (idx: number, patch: Partial<ProactiveRule>) => {
    const next = rules.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    update({ proactiveRules: next });
  };
  const removeRule = (idx: number) => update({ proactiveRules: rules.filter((_, i) => i !== idx) });
  const addRule = () => update({ proactiveRules: [...rules, emptyRule()] });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section>
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
          {t('wizard.systemPrompt')}
        </div>
        <textarea
          value={draft.systemPrompt ?? ''}
          onChange={(e) => update({ systemPrompt: e.target.value || undefined })}
          placeholder={t('wizard.systemPromptPlaceholder')}
          rows={5}
          style={{
            width: '100%',
            padding: '6px 10px',
            fontSize: 13,
            background: 'var(--color-bg-surface-2)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text-primary)',
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
      </section>

      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{t('wizard.proactiveRules')}</div>
          <Button size="sm" variant="ghost" type="button" onClick={addRule}>+ {t('wizard.addRule')}</Button>
        </div>
        {rules.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>—</div>
        )}
        {rules.map((r, i) => (
          <div
            key={r.id}
            data-testid={`wizard-rule-${i}`}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr auto auto',
              gap: 6,
              marginBottom: 4,
              fontSize: 12,
              alignItems: 'center',
            }}
          >
            <input
              value={r.trigger}
              onChange={(e) => updateRule(i, { trigger: e.target.value })}
              placeholder={t('wizard.ruleTrigger')}
              style={smallInputStyle}
            />
            <input
              value={r.condition}
              onChange={(e) => updateRule(i, { condition: e.target.value })}
              placeholder={t('wizard.ruleCondition')}
              style={smallInputStyle}
            />
            <input
              value={r.action}
              onChange={(e) => updateRule(i, { action: e.target.value })}
              placeholder={t('wizard.ruleAction')}
              style={smallInputStyle}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                checked={r.enabled}
                onChange={(e) => updateRule(i, { enabled: e.target.checked })}
              />
              <span>{t('wizard.ruleEnabled')}</span>
            </label>
            <button
              type="button"
              onClick={() => removeRule(i)}
              aria-label={t('wizard.removeRule')}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-danger)',
                fontSize: 14,
              }}
            >✗</button>
          </div>
        ))}
      </section>
    </div>
  );
}

const smallInputStyle: CSSProperties = {
  padding: '4px 8px',
  fontSize: 12,
  background: 'var(--color-bg-surface-2)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text-primary)',
  minWidth: 0,
};
