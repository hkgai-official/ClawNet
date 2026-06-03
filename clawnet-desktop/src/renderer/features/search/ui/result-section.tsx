import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  label: string;
  count: number;
  children: ReactNode;
}

/**
 * Wraps a group of result rows with a small heading + count badge. Renders
 * `null` when `count === 0` so we don't show empty headers between
 * populated sections.
 */
export function ResultSection({ label, count, children }: Props) {
  const { t } = useTranslation('search');
  if (count === 0) return null;
  return (
    <section style={{ paddingTop: 8 }}>
      <div
        style={{
          padding: '4px 12px',
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--color-text-muted)',
          display: 'flex',
          justifyContent: 'space-between',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        <span>{label}</span>
        <span style={{ fontWeight: 500, textTransform: 'none' }}>
          {t('resultsCount', { count })}
        </span>
      </div>
      <div>{children}</div>
    </section>
  );
}
