import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '../../../../../shared/domain/chat';
import { TaskResultCardDataSchema } from '../../../../../shared/domain/card-data';

interface Props {
  message: ChatMessage;
}

/**
 * Task result card: success/failure header + summary + optional error pane +
 * collapsible details (filesProcessed + log lines). Ports macOS
 * `RichCardViews.swift:122-178` (TaskResultCardView).
 */
export function TaskResultCard({ message }: Props) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const parsed = TaskResultCardDataSchema.safeParse(message.content);
  if (!parsed.success) {
    return (
      <div
        data-testid="task-result-card"
        style={{ padding: 8, fontSize: 11, color: 'var(--color-danger)' }}
      >
        [task_result payload invalid]
      </div>
    );
  }
  const { success, summary, error, details } = parsed.data;
  const tint = success ? 'var(--color-success)' : 'var(--color-danger)';
  const hasDetails =
    details && (details.filesProcessed != null || (details.logs && details.logs.length > 0));

  return (
    <div
      data-testid="task-result-card"
      style={{
        padding: 12,
        maxWidth: 300,
        background: success
          ? 'var(--color-success-bg-subtle)'
          : 'var(--color-danger-bg-subtle)',
        borderRadius: 10,
        border: `1px solid ${success ? 'var(--color-success-border-subtle)' : 'var(--color-danger-border-subtle)'}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: tint }}>{success ? '✓' : '✗'}</span>
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          {success
            ? t('taskCompleted', { defaultValue: 'Completed' })
            : t('taskFailed', { defaultValue: 'Failed' })}
        </span>
      </div>
      <div style={{ fontSize: 13 }}>{summary}</div>
      {error && (
        <div
          style={{
            padding: 8,
            fontSize: 11,
            color: 'var(--color-danger)',
            background: 'var(--color-danger-bg-subtle)',
            borderRadius: 6,
          }}
        >
          {error}
        </div>
      )}
      {hasDetails && (
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          style={{
            background: 'none',
            border: 'none',
            textAlign: 'left',
            padding: 0,
            fontSize: 11,
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
          }}
        >
          {open ? '▼' : '▶'} {t('details', { defaultValue: 'Details' })}
        </button>
      )}
      {open && details && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}>
          {details.filesProcessed != null && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--color-text-secondary)' }}>
                {t('filesProcessed', { defaultValue: 'Files processed' })}
              </span>
              <span>{details.filesProcessed}</span>
            </div>
          )}
          {details.logs && details.logs.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ color: 'var(--color-text-secondary)' }}>
                {t('logs', { defaultValue: 'Logs' })}
              </span>
              {details.logs.slice(0, 10).map((log, i) => (
                <div
                  key={i}
                  style={{
                    fontFamily: 'monospace',
                    fontSize: 10,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {log}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
