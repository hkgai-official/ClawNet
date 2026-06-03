// src/renderer/features/audit/ui/security-event-center.tsx
//
// Mirrors macOS SecurityEventCenter (SecurityEventCenter.swift:20-100).

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuditEvents } from '../hooks/use-audit-events';
import { useAuditEventsStore, selectUnreadCount } from '../state/audit-events-slice';
import { CategoryChip } from './category-chip';
import { AuditEventRow } from './audit-event-row';
import {
  categorizeAuditEvent,
  type AuditCategory,
} from '../../../../shared/domain/audit';

const CATEGORIES: AuditCategory[] = [
  'boundary_violation',
  'access_denied',
  'dialog_approval',
  'approval',
  'other',
];

export function SecurityEventCenter() {
  const { t } = useTranslation('audit');
  useAuditEvents();
  const events = useAuditEventsStore((s) => s.events);
  const markAllAsRead = useAuditEventsStore((s) => s.markAllAsRead);
  const unread = useAuditEventsStore(selectUnreadCount);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<AuditCategory | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((ev) => {
      const matchesCategory =
        category === null || categorizeAuditEvent(ev.eventType) === category;
      if (!matchesCategory) return false;
      if (q.length === 0) return true;
      if (ev.agentName?.toLowerCase().includes(q)) return true;
      for (const v of Object.values(ev.details)) {
        if (typeof v === 'string' && v.toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [events, search, category]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-bg-app)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '16px 16px 8px 16px',
        }}
      >
        <span style={{ fontSize: 18, color: 'var(--color-warning)' }} aria-hidden>
          🛡
        </span>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{t('title')}</span>
        <span style={{ flex: 1 }} />
        {unread > 0 && (
          <button
            type="button"
            onClick={markAllAsRead}
            style={{
              fontSize: 11,
              padding: '2px 8px',
              border: 'none',
              background: 'transparent',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
            }}
          >
            {t('markAllRead')}
          </button>
        )}
      </div>

      <div style={{ padding: '0 16px' }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('search')}
          style={{
            width: '100%',
            padding: '6px 10px',
            fontSize: 12,
            border: '1px solid var(--color-border-subtle)',
            background: 'var(--color-bg-surface)',
            color: 'var(--color-text-primary)',
            borderRadius: 'var(--radius-sm)',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: '8px 16px',
          overflowX: 'auto',
          flexShrink: 0,
        }}
      >
        <CategoryChip
          label={t('categories.all')}
          isSelected={category === null}
          onClick={() => setCategory(null)}
        />
        {CATEGORIES.map((c) => (
          <CategoryChip
            key={c}
            label={t(`categories.${c}`)}
            isSelected={category === c}
            onClick={() => setCategory(c)}
          />
        ))}
      </div>

      <div style={{ height: 1, background: 'var(--color-border-subtle)' }} />

      {filtered.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-text-secondary)',
            textAlign: 'center',
            gap: 8,
          }}
        >
          <span style={{ fontSize: 36 }} aria-hidden>
            🛡
          </span>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>
            {events.length === 0 ? t('emptyTitle') : t('noMatchTitle')}
          </p>
          <p style={{ margin: 0, fontSize: 12 }}>
            {events.length === 0 ? t('emptyDescription') : t('noMatchDescription')}
          </p>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.map((ev) => (
            <AuditEventRow key={ev.id} event={ev} />
          ))}
        </div>
      )}
    </div>
  );
}
