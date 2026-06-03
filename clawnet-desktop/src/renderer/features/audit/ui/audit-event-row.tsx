// src/renderer/features/audit/ui/audit-event-row.tsx
//
// Mirrors macOS AuditEventRow (SecurityEventCenter.swift:104-188).
// onAppear is replaced by a useEffect that fires once when the row mounts —
// the audit-events-slice handles the actual mark-as-read mutation.

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  categorizeAuditEvent,
  type AuditEvent,
  type AuditCategory,
} from '../../../../shared/domain/audit';
import { useAuditEventsStore } from '../state/audit-events-slice';

interface Props {
  event: AuditEvent;
}

const CATEGORY_COLOR: Record<AuditCategory, string> = {
  boundary_violation: 'var(--color-danger)',
  access_denied: 'var(--color-warning)',
  dialog_approval: 'var(--color-info)',
  approval: 'var(--color-brand-500)',
  other: 'var(--color-text-secondary)',
};

const CATEGORY_ICON: Record<AuditCategory, string> = {
  boundary_violation: '⚠',
  access_denied: '🛡',
  dialog_approval: '💬',
  approval: '✓',
  other: 'ⓘ',
};

export function AuditEventRow({ event }: Props) {
  const { t } = useTranslation('audit');
  const markAsRead = useAuditEventsStore((s) => s.markAsRead);
  const category = categorizeAuditEvent(event.eventType);
  const color = CATEGORY_COLOR[category];

  useEffect(() => {
    if (!event.isRead) markAsRead(event.id);
  }, [event.id, event.isRead, markAsRead]);

  const description = describeEvent(t, event);
  const detail = event.details.detail ?? event.details.reason ?? '';

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 16px' }}>
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: `color-mix(in srgb, ${color} 12%, transparent)`,
          color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 16,
          flexShrink: 0,
        }}
        aria-hidden
      >
        {CATEGORY_ICON[category]}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color }}>
            {t(`categories.${category}`)}
          </span>
          <span style={{ flex: 1 }} />
          <span
            style={{
              fontSize: 11,
              fontFamily: 'monospace',
              color: 'var(--color-text-secondary)',
            }}
          >
            {formatTime(event.timestamp)}
          </span>
          {!event.isRead && (
            <span
              aria-label="unread"
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--color-brand-500)',
              }}
            />
          )}
        </div>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            lineHeight: '18px',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {description}
        </p>
        {detail && (
          <p
            style={{
              margin: 0,
              fontSize: 11,
              color: 'var(--color-text-secondary)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {t('detailLabel')} {detail}
          </p>
        )}
      </div>
    </div>
  );
}

function describeEvent(t: TFunction<'audit'>, event: AuditEvent): string {
  const agent = event.agentName ?? 'Agent';
  switch (event.eventType) {
    case 'audit.boundary_violation': {
      const tag = event.tagRole ?? event.details.tag_name ?? t('unknownTag');
      const violationType = event.details.violation_type ?? 'unknown';
      const path = event.details.attempted_path ?? t('unknownPath');
      return t('events.boundary_violation', { tag, agent, violationType, path });
    }
    case 'audit.access_denied':
    case 'audit.file_access': {
      const path = event.details.path ?? t('unknownPath');
      const command = event.details.command ?? 'file_access';
      return t('events.access_denied', { agent, command, path });
    }
    case 'dialog.approval_request': {
      const topic = event.details.topic ?? '';
      const owner = event.details.initiator_owner ?? '';
      return t('events.dialog_approval_request', { owner, agent, topic });
    }
    case 'approval.requested':
      return t('events.approval_requested', { agent });
    default:
      return t('events.fallback', { agent, eventType: event.eventType });
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
