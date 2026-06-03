import { useConnection } from '../../../hooks/use-connection';

const COLORS: Record<string, { bg: string; label: string }> = {
  connected:    { bg: 'var(--color-success)', label: 'Connected' },
  connecting:   { bg: 'var(--color-info)',    label: 'Connecting…' },
  reconnecting: { bg: 'var(--color-warning)', label: 'Reconnecting…' },
  disconnected: { bg: 'var(--color-text-muted)', label: 'Offline' },
};

export function StatusPill() {
  const { status, manualReconnect } = useConnection();
  const c = COLORS[status] ?? COLORS['disconnected']!;
  return (
    <button
      type="button"
      onClick={() => { void manualReconnect(); }}
      className="text-xs px-2 py-1"
      style={{
        background: c.bg,
        color: 'var(--color-on-status)',
        borderRadius: 'var(--radius-sm)',
        border: 'none',
      }}
      aria-label={`Connection ${c.label}, click to retry`}
    >
      {c.label}
    </button>
  );
}
