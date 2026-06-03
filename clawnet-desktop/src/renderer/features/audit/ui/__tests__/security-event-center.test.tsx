// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { SecurityEventCenter } from '../security-event-center';
import type { AuditEvent } from '../../../../../shared/domain/audit';

const markAllAsRead = vi.fn();
const markAsRead = vi.fn();
let events: AuditEvent[] = [];

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Surface interpolation values so AuditEventRow's describeEvent
    // output carries the agent name (the search filter target).
    t: (k: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts === 'object') {
        const vals = Object.entries(opts)
          .filter(([key]) => key !== 'defaultValue')
          .map(([, v]) => String(v));
        return vals.length > 0 ? `${k}:${vals.join(',')}` : k;
      }
      return k;
    },
  }),
}));

vi.mock('../../hooks/use-audit-events', () => ({
  useAuditEvents: () => undefined,
}));

vi.mock('../../state/audit-events-slice', () => ({
  useAuditEventsStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ events, markAllAsRead, markAsRead }),
  selectUnreadCount: (s: { events: AuditEvent[] }) =>
    s.events.filter((e) => !e.isRead).length,
}));

function ev(over: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: `e${Math.random()}`,
    eventType: 'audit.access_denied',
    details: {},
    timestamp: '2026-05-15T00:00:00Z',
    isRead: true,
    ...over,
  };
}

beforeEach(() => {
  cleanup();
  markAllAsRead.mockClear();
  markAsRead.mockClear();
  events = [];
});

describe('SecurityEventCenter', () => {
  it('shows the empty state when there are no events', () => {
    events = [];
    render(<SecurityEventCenter />);
    expect(screen.getByText('emptyTitle')).toBeTruthy();
  });

  it('search filters events by agent name', () => {
    events = [
      ev({ id: 'e1', agentName: 'Alpha' }),
      ev({ id: 'e2', agentName: 'Beta' }),
    ];
    render(<SecurityEventCenter />);
    fireEvent.change(screen.getByPlaceholderText('search'), { target: { value: 'alpha' } });
    // Beta filtered out → its row gone; Alpha row still there.
    expect(screen.getByText(/Alpha/)).toBeTruthy();
    expect(screen.queryByText(/Beta/)).toBeNull();
  });

  it('a non-matching search shows the no-match state', () => {
    events = [ev({ id: 'e1', agentName: 'Alpha' })];
    render(<SecurityEventCenter />);
    fireEvent.change(screen.getByPlaceholderText('search'), { target: { value: 'zzz' } });
    expect(screen.getByText('noMatchTitle')).toBeTruthy();
  });

  it('category chip filters by event category', () => {
    events = [
      ev({ id: 'e1', eventType: 'audit.boundary_violation', agentName: 'BV' }),
      ev({ id: 'e2', eventType: 'audit.access_denied', agentName: 'AD' }),
    ];
    render(<SecurityEventCenter />);
    // The chip is a button; the event-row category label is a span —
    // target the button to disambiguate.
    fireEvent.click(screen.getByRole('button', { name: 'categories.boundary_violation' }));
    expect(screen.getByText(/BV/)).toBeTruthy();
    expect(screen.queryByText(/AD/)).toBeNull();
  });

  it('mark-all-read button appears only when there are unread events', () => {
    events = [ev({ id: 'e1', isRead: true })];
    const { rerender } = render(<SecurityEventCenter />);
    expect(screen.queryByText('markAllRead')).toBeNull();

    events = [ev({ id: 'e2', isRead: false })];
    rerender(<SecurityEventCenter />);
    fireEvent.click(screen.getByText('markAllRead'));
    expect(markAllAsRead).toHaveBeenCalledTimes(1);
  });
});
