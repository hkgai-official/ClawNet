import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentsStore } from '../state/agents-slice';
import { useTask, useTaskLogs } from '../hooks/use-task';
import { Icon } from '../../../components/icon';

function LogLevelBadge({ level }: { level: string }) {
  const colorMap: Record<string, string> = {
    error: 'var(--color-danger)',
    warning: 'var(--color-warning)',
    info: 'var(--color-text-secondary)',
    debug: 'var(--color-text-muted)',
  };
  return (
    <span
      className="text-xs font-mono shrink-0"
      style={{ color: colorMap[level] ?? 'var(--color-text-secondary)', minWidth: 40 }}
    >
      {level.toUpperCase()}
    </span>
  );
}

function FilterChip({
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
      onClick={onClick}
      style={{
        fontSize: 11,
        padding: '3px 8px',
        borderRadius: 4,
        border: '1px solid',
        borderColor: selected ? 'var(--color-brand-500)' : 'transparent',
        background: selected
          ? 'var(--color-bg-surface-2)'
          : 'var(--color-bg-surface-2)',
        color: selected ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

export function ExecutionLogDrawer() {
  const { t } = useTranslation('agent');
  const taskId = useAgentsStore((s) => s.logDrawerOpenForTaskId);
  const setLogDrawer = useAgentsStore((s) => s.setLogDrawer);

  const { data: task } = useTask(taskId);
  const { data: logs } = useTaskLogs(taskId);

  const [searchText, setSearchText] = useState('');
  const [selectedStep, setSelectedStep] = useState<string | null>(null);

  const uniqueSteps = useMemo(
    () => Array.from(new Set((logs ?? []).map((l) => l.step))).sort(),
    [logs],
  );

  const filteredLogs = useMemo(() => {
    const needle = searchText.trim().toLowerCase();
    return (logs ?? []).filter((log) => {
      const matchesSearch =
        needle.length === 0 ||
        log.message.toLowerCase().includes(needle) ||
        log.step.toLowerCase().includes(needle);
      const matchesStep = selectedStep === null || log.step === selectedStep;
      return matchesSearch && matchesStep;
    });
  }, [logs, searchText, selectedStep]);

  if (!taskId) return null;

  return (
    <aside
      style={{
        width: 420,
        minWidth: 420,
        maxWidth: 420,
        borderLeft: '1px solid var(--color-border-subtle)',
        background: 'var(--color-bg-surface)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-border-subtle)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexShrink: 0,
        }}
      >
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium mb-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {t('task.executionLog')}
          </div>
          {task && (
            <div className="text-sm font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
              {task.description}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setLogDrawer(null)}
          aria-label={t('task.closeLog')}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-text-secondary)',
            display: 'flex',
            alignItems: 'center',
            padding: '4px',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          <Icon name="xmark" size={18} aria-hidden />
        </button>
      </header>

      {/* Filters — mirrors macOS ExecutionLogDrawer.swift:46-76 */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--color-border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 8px',
            background: 'var(--color-bg-surface-2)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          <Icon name="magnifyingglass" size={12} aria-hidden />
          <input
            type="text"
            data-testid="task-log-search"
            placeholder={t('task.searchLogs', { defaultValue: 'Search logs' })}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 12,
              color: 'var(--color-text-primary)',
            }}
          />
        </div>
        {uniqueSteps.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: 4,
              overflowX: 'auto',
              paddingBottom: 2,
            }}
          >
            <FilterChip
              label={t('task.filterAll', { defaultValue: 'All' })}
              selected={selectedStep === null}
              onClick={() => setSelectedStep(null)}
            />
            {uniqueSteps.map((step) => (
              <FilterChip
                key={step}
                label={step}
                selected={selectedStep === step}
                onClick={() => setSelectedStep(step)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Log list */}
      <div className="flex-1 overflow-y-auto" style={{ padding: '8px 0' }}>
        {!logs || logs.length === 0 ? (
          <div
            className="text-sm text-center py-8"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {t('task.noLogs')}
          </div>
        ) : filteredLogs.length === 0 ? (
          <div
            className="text-sm text-center py-8"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {t('task.noMatchingLogs', { defaultValue: 'No matching logs' })}
          </div>
        ) : (
          <ul className="flex flex-col" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {filteredLogs.map((log) => (
              <li
                key={`${log.timestamp}-${log.step}`}
                style={{
                  display: 'flex',
                  gap: '8px',
                  padding: '5px 16px',
                  borderBottom: '1px solid var(--color-border-subtle)',
                  alignItems: 'flex-start',
                }}
              >
                <span
                  className="text-xs font-mono shrink-0"
                  style={{ color: 'var(--color-text-muted)', minWidth: 60, paddingTop: 1 }}
                >
                  {new Date(log.timestamp * 1000).toLocaleTimeString()}
                </span>
                <span
                  className="text-xs font-mono shrink-0"
                  style={{
                    padding: '1px 4px',
                    borderRadius: 3,
                    background: 'var(--color-bg-surface-2)',
                    color: 'var(--color-text-secondary)',
                    fontSize: 10,
                  }}
                >
                  {log.step}
                </span>
                <LogLevelBadge level={log.level ?? 'info'} />
                <span
                  className="text-sm break-words min-w-0"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {log.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
