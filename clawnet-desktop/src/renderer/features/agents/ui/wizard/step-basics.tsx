import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentWizardStore } from '../../state/agent-wizard-slice';
import { useTags } from '../../../tags/hooks/use-tags';

export function StepBasics() {
  const { t } = useTranslation(['agent', 'tags']);
  const draft = useAgentWizardStore((s) => s.draft);
  const update = useAgentWizardStore((s) => s.updateDraft);
  const selectedTagId = useAgentWizardStore((s) => s.selectedTagId);
  const setSelectedTagId = useAgentWizardStore((s) => s.setSelectedTagId);
  const { data: tags = [] } = useTags();
  if (!draft) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <FieldLabel label={t('agent:wizard.displayName')}>
        <input
          value={draft.displayName}
          onChange={(e) => update({ displayName: e.target.value })}
          placeholder={t('agent:wizard.displayNamePlaceholder')}
          style={inputStyle}
        />
      </FieldLabel>

      <FieldLabel label={t('agent:wizard.description')}>
        <textarea
          value={draft.description ?? ''}
          onChange={(e) => update({ description: e.target.value || undefined })}
          placeholder={t('agent:wizard.descriptionPlaceholder')}
          rows={3}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </FieldLabel>

      <FieldLabel label={t('agent:wizard.avatarUrl')}>
        <input
          value={draft.avatarUrl ?? ''}
          onChange={(e) => update({ avatarUrl: e.target.value || undefined })}
          placeholder="https://…"
          style={inputStyle}
        />
      </FieldLabel>

      <FieldLabel label={t('tags:assignTag')}>
        <select
          data-testid="wizard-tag-select"
          value={selectedTagId ?? ''}
          onChange={(e) => setSelectedTagId(e.target.value || null)}
          style={inputStyle}
        >
          <option value="">{t('tags:noTag')}</option>
          {tags.map((tag) => (
            <option key={tag.id} value={tag.id}>{tag.displayName}</option>
          ))}
        </select>
      </FieldLabel>
    </div>
  );
}

const inputStyle: CSSProperties = {
  padding: '6px 10px',
  fontSize: 13,
  background: 'var(--color-bg-surface-2)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--color-text-primary)',
};

function FieldLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{label}</span>
      {children}
    </label>
  );
}
