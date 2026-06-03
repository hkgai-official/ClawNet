import { useTranslation } from 'react-i18next';
import { useAgent } from '../hooks/use-agents';
import { useAgentsStore } from '../state/agents-slice';

export function AgentProfile() {
  const { t } = useTranslation('agent');
  const activeId = useAgentsStore((s) => s.activeAgentId);
  const { data } = useAgent(activeId);

  if (!activeId || !data) {
    return (
      <div className="flex items-center justify-center h-full">
        <span style={{ color: 'var(--color-text-muted)' }}>—</span>
      </div>
    );
  }
  return (
    <div className="p-6 overflow-y-auto" style={{ background: 'var(--color-bg-app)' }}>
      <section
        className="p-6 flex flex-col gap-4"
        style={{
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-md)',
          maxWidth: 800,
        }}
      >
        <header>
          <h2 className="text-xl font-semibold m-0">{data.displayName}</h2>
          <p className="text-sm m-0" style={{ color: 'var(--color-text-secondary)' }}>
            {data.agentType} • {t(`status.${data.status}`)} • {data.executionMode}
          </p>
        </header>
        {data.description && (
          <p className="text-sm m-0" style={{ color: 'var(--color-text-primary)' }}>
            {data.description}
          </p>
        )}
        <div>
          <div className="text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
            {t('profile.capabilities')}
          </div>
          <div className="flex flex-wrap gap-1">
            {data.capabilities.map((c) => (
              <span
                key={c}
                className="text-xs px-2 py-0.5"
                style={{
                  background: 'var(--color-bg-surface-2)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text-primary)',
                }}
              >
                {t(`capability.${c}`, { defaultValue: c })}
              </span>
            ))}
          </div>
        </div>
        {(data.modelProvider || data.modelName) && (
          <div>
            <div className="text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
              {t('profile.model')}
            </div>
            <div className="text-sm">
              {data.modelProvider}{data.modelProvider && data.modelName ? ' / ' : ''}{data.modelName}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
