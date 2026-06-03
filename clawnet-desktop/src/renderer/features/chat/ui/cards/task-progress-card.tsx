import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '../../../../../shared/domain/chat';
import { TaskProgressCardDataSchema } from '../../../../../shared/domain/card-data';

interface Props {
  message: ChatMessage;
}

/**
 * Task progress card with stage label + percentage + progress bar + optional
 * details map. Ports macOS `RichCardViews.swift:75-117` (TaskProgressCardView).
 *
 * `progress` accepts either 0..1 fraction or 0..100 integer (zod transform
 * in card-data.ts normalizes to 0..1).
 */
export function TaskProgressCard({ message }: Props) {
  const { t } = useTranslation('chat');
  const parsed = TaskProgressCardDataSchema.safeParse(message.content);
  if (!parsed.success) {
    return (
      <div
        data-testid="task-progress-card"
        style={{ padding: 8, fontSize: 11, color: 'var(--color-danger)' }}
      >
        [task_progress payload invalid]
      </div>
    );
  }
  const { stage, progress, details } = parsed.data;
  const pct = Math.round(progress * 100);

  return (
    <div
      data-testid="task-progress-card"
      style={{
        padding: 12,
        maxWidth: 280,
        background: 'var(--color-info-bg-subtle)',
        borderRadius: 10,
        border: '1px solid var(--color-info-border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: 'var(--color-info)' }}>⚙</span>
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          {t('taskInProgress', { defaultValue: 'In progress' })}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontFamily: 'monospace',
            fontWeight: 600,
            fontSize: 12,
            color: 'var(--color-info)',
          }}
        >
          {pct}%
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{stage}</div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          width: '100%',
          height: 4,
          background: 'var(--color-info-border-subtle)',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: 'var(--color-info)',
            transition: 'width 0.3s',
          }}
        />
      </div>
      {details && Object.keys(details).length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 4 }}>
          {Object.entries(details)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => (
              <div
                key={k}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 11,
                }}
              >
                <span style={{ color: 'var(--color-text-secondary)' }}>{k}</span>
                <span>{v}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
