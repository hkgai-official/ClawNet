import { useTranslation } from 'react-i18next';
import { useAgentWizardStore } from '../../state/agent-wizard-slice';
import { DEFAULT_AGENT_PERMISSIONS, type AgentPermissions } from '../../../../../shared/domain/agent';

const BOOL_KEYS: Array<keyof Omit<AgentPermissions, 'maxConcurrentTasks' | 'requireApprovalFor'>> = [
  'canReadFiles', 'canWriteFiles', 'canAccessNetwork', 'canExecuteCode',
  'canAccessCalendar', 'canAccessEmail',
];

export function StepPermissions() {
  const { t } = useTranslation('agent');
  const draft = useAgentWizardStore((s) => s.draft);
  const update = useAgentWizardStore((s) => s.updateDraft);
  if (!draft) return null;

  const perms = draft.permissions ?? DEFAULT_AGENT_PERMISSIONS;
  const setPerms = (patch: Partial<AgentPermissions>) =>
    update({ permissions: { ...perms, ...patch } });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {BOOL_KEYS.map((k) => (
        <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={Boolean(perms[k])}
            onChange={(e) => setPerms({ [k]: e.target.checked })}
          />
          <span style={{ fontSize: 13 }}>{t(`permission.${k}`)}</span>
        </label>
      ))}

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
          {t('permission.maxConcurrentTasks')}
        </span>
        <input
          type="number"
          min={1}
          value={perms.maxConcurrentTasks}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n > 0) setPerms({ maxConcurrentTasks: Math.floor(n) });
          }}
          style={{
            padding: '6px 10px',
            fontSize: 13,
            width: 100,
            background: 'var(--color-bg-surface-2)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text-primary)',
          }}
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
          {t('permission.requireApprovalFor')}
        </span>
        <input
          value={(perms.requireApprovalFor ?? []).join(', ')}
          onChange={(e) => {
            const arr = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
            setPerms({ requireApprovalFor: arr.length > 0 ? arr : undefined });
          }}
          placeholder="file_write, code_execution"
          style={{
            padding: '6px 10px',
            fontSize: 13,
            background: 'var(--color-bg-surface-2)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text-primary)',
          }}
        />
      </label>
    </div>
  );
}
