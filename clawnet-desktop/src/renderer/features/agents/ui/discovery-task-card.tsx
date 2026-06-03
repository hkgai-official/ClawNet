import { useTranslation } from 'react-i18next';
import { CheckCircle2, Clock, Loader2, Users, XCircle } from 'lucide-react';
import type { DiscoveryTask } from '../../../../shared/domain/discovery';
import { useDiscoveryActions } from '../hooks/use-discovery';
import { Button } from '../../../components/ui/button';

interface DiscoveryTaskCardProps {
  task: DiscoveryTask;
}

/**
 * Multi-user discovery task card. Ports macOS
 * `DiscoveryTaskCardView.swift:1-249`: header + intent + progress bar +
 * three sub-sections (completed results / active sessions / pending
 * queries) + action row. Hop count is shown in the progress label when
 * `maxHops > 1`.
 *
 * The server status string drives both the status badge and which actions
 * are shown. The Win port maps `pending_confirmation` to the macOS
 * `pending` button branch (server emits the longer name; macOS shortens
 * it before reaching the view).
 */
export function DiscoveryTaskCard({ task }: DiscoveryTaskCardProps) {
  const { t } = useTranslation('agent');
  const { confirm, cancel } = useDiscoveryActions();

  const status = task.status;
  const isPendingConfirmation = status === 'pending_confirmation' || status === 'pending';
  const isRunning = status === 'running' || status === 'completing';
  const isCompleted = status === 'completed';
  const isFailed = status === 'failed' || status === 'cancelled';
  const isActive = isPendingConfirmation || isRunning;

  const completed = task.completedResults;
  const active = task.activeSessions;
  const pending = task.pendingQueries;
  const totalItems = completed.length + active.length + pending.length;
  const progress = totalItems > 0 ? completed.length / totalItems : 0;
  const progressPercent = Math.round(progress * 100);

  // Map status → status-token color for the badge + progress bar. Matches
  // macOS DiscoveryTaskCardView.statusColor.
  const accent = isCompleted
    ? 'var(--color-success)'
    : isFailed
    ? 'var(--color-danger)'
    : 'var(--color-purple)';
  const accentBg = isCompleted
    ? 'var(--color-success-bg-subtle)'
    : isFailed
    ? 'var(--color-danger-bg-subtle)'
    : 'var(--color-purple-bg-subtle)';
  const accentBorder = isCompleted
    ? 'var(--color-success-border-subtle)'
    : isFailed
    ? 'var(--color-danger-border-subtle)'
    : 'var(--color-purple-border-subtle)';

  return (
    <div
      data-testid="discovery-task-card"
      style={{
        background: accentBg,
        border: `1px solid ${accentBorder}`,
        borderRadius: 10,
        padding: 12,
        maxWidth: 320,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <Header status={status} accent={accent} />
      {task.originalIntent && <IntentSection intent={task.originalIntent} />}
      <ProgressSection
        completed={completed.length}
        total={totalItems}
        percent={progressPercent}
        accent={accent}
        currentHop={task.currentHopCount}
        maxHops={task.maxHops}
      />
      {completed.length > 0 && <CompletedSection items={completed} />}
      {active.length > 0 && <ActiveSection items={active} />}
      {pending.length > 0 && <PendingSection items={pending} />}

      {isActive && (
        <div className="flex gap-2 justify-end">
          {isPendingConfirmation && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => confirm.mutate({ id: task.id })}
              disabled={confirm.isPending}
            >
              {t('discovery.confirm')}
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => cancel.mutate({ id: task.id })}
            disabled={cancel.isPending}
          >
            {t('discovery.cancel')}
          </Button>
        </div>
      )}
    </div>
  );
}

interface HeaderProps {
  status: string;
  accent: string;
}

function Header({ status, accent }: HeaderProps) {
  const { t } = useTranslation('agent');
  return (
    <div className="flex items-center gap-2">
      <Users size={14} aria-hidden style={{ color: accent }} />
      <span style={{ fontWeight: 600, fontSize: 13 }}>
        {t('discovery.cardTitle')}
      </span>
      <span
        className="ml-auto"
        style={{
          fontSize: 10,
          padding: '2px 6px',
          borderRadius: 3,
          background: 'var(--color-bg-overlay)',
          color: accent,
          fontWeight: 600,
        }}
      >
        {t(`discovery.status.${status}`, { defaultValue: status })}
      </span>
    </div>
  );
}

function IntentSection({ intent }: { intent: string }) {
  return (
    <div
      style={{
        fontSize: 12,
        color: 'var(--color-text-secondary)',
        display: '-webkit-box',
        WebkitLineClamp: 3,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}
    >
      {intent}
    </div>
  );
}

interface ProgressProps {
  completed: number;
  total: number;
  percent: number;
  accent: string;
  currentHop: number;
  maxHops: number;
}

function ProgressSection({ completed, total, percent, accent, currentHop, maxHops }: ProgressProps) {
  const { t } = useTranslation('agent');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="flex items-center" style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
        <span>
          {t('discovery.completedOf', {
            completed,
            total,
            defaultValue: '{{completed}} of {{total}} completed',
          })}
        </span>
        {maxHops > 1 && (
          <span style={{ marginLeft: 8 }}>
            ·{' '}
            {t('discovery.hopCount', {
              current: currentHop,
              max: maxHops,
              defaultValue: 'hop {{current}}/{{max}}',
            })}
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', color: accent, fontWeight: 600 }}>
          {percent}%
        </span>
      </div>
      <div
        style={{
          position: 'relative',
          height: 4,
          borderRadius: 2,
          background: 'var(--color-bg-overlay)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: `${percent}%`,
            background: accent,
            transition: 'width 200ms ease-out',
          }}
        />
      </div>
    </div>
  );
}

function CompletedSection({ items }: { items: ReadonlyArray<Record<string, unknown>> }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.map((item, i) => {
        const owner = (item['target_owner'] as string | undefined) ?? '?';
        const summary = (item['summary'] as string | undefined) ?? '';
        const itemStatus = (item['status'] as string | undefined) ?? 'completed';
        const isSuccess = itemStatus === 'completed' || itemStatus === 'resolved';
        return (
          <div key={i} className="flex items-start gap-2" style={{ fontSize: 11 }}>
            {isSuccess ? (
              <CheckCircle2
                size={12}
                aria-hidden
                style={{ color: 'var(--color-success)', flexShrink: 0, marginTop: 1 }}
              />
            ) : (
              <XCircle
                size={12}
                aria-hidden
                style={{ color: 'var(--color-danger)', flexShrink: 0, marginTop: 1 }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{owner}</div>
              {summary && (
                <div
                  style={{
                    color: 'var(--color-text-secondary)',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {summary}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ActiveSection({
  items,
}: {
  items: ReadonlyArray<Record<string, unknown>>;
}) {
  const { t } = useTranslation('agent');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.map((item, i) => {
        const owner = (item['target_owner'] as string | undefined) ?? '?';
        const topic = (item['topic'] as string | undefined) ?? '';
        return (
          <div key={i} className="flex items-start gap-2" style={{ fontSize: 11 }}>
            <Loader2
              size={12}
              aria-hidden
              className="animate-spin"
              style={{ color: 'var(--color-purple)', flexShrink: 0, marginTop: 1 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: 'var(--color-purple)' }}>
                {t('discovery.contacting', {
                  owner,
                  defaultValue: 'Contacting {{owner}}',
                })}
              </div>
              {topic && (
                <div style={{ color: 'var(--color-text-secondary)' }} className="truncate">
                  {topic}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PendingSection({
  items,
}: {
  items: ReadonlyArray<Record<string, unknown>>;
}) {
  const { t } = useTranslation('agent');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.map((item, i) => {
        const owner = (item['target_owner'] as string | undefined) ?? '?';
        const topic = (item['topic'] as string | undefined) ?? '';
        return (
          <div key={i} className="flex items-start gap-2" style={{ fontSize: 11 }}>
            <Clock
              size={12}
              aria-hidden
              style={{ color: 'var(--color-text-muted)', flexShrink: 0, marginTop: 1 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: 'var(--color-text-secondary)' }}>
                {t('discovery.pendingContact', {
                  owner,
                  defaultValue: 'Pending: {{owner}}',
                })}
              </div>
              {topic && (
                <div style={{ color: 'var(--color-text-muted)' }} className="truncate">
                  {topic}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
