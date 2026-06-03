// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { AuditEventRow } from '../audit-event-row';
import type { AuditEvent } from '../../../../../shared/domain/audit';

const markAsRead = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      // Surface event-type variant + interpolation values so we can grep
      // for them in assertions.
      if (k.startsWith('events.')) {
        const ev = k.replace('events.', '');
        return `[${ev}]${opts ? ' ' + JSON.stringify(opts) : ''}`;
      }
      if (k.startsWith('categories.')) return k.replace('categories.', '');
      return k;
    },
  }),
}));

vi.mock('../../state/audit-events-slice', () => ({
  useAuditEventsStore: (selector: (s: { markAsRead: typeof markAsRead }) => unknown) =>
    selector({ markAsRead }),
}));

beforeEach(() => {
  cleanup();
  markAsRead.mockClear();
});

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 'e1',
    eventType: 'audit.boundary_violation',
    details: {},
    timestamp: '2026-05-15T12:34:56Z',
    isRead: false,
    ...overrides,
  };
}

describe('AuditEventRow — categorization', () => {
  it('renders boundary_violation icon + category label', () => {
    render(<AuditEventRow event={makeEvent({ eventType: 'audit.boundary_violation' })} />);
    expect(screen.getByText('boundary_violation')).toBeTruthy();
    expect(screen.getByText('⚠')).toBeTruthy();
  });

  it('routes audit.access_denied to access_denied category', () => {
    render(<AuditEventRow event={makeEvent({ eventType: 'audit.access_denied' })} />);
    expect(screen.getByText('access_denied')).toBeTruthy();
    expect(screen.getByText('🛡')).toBeTruthy();
  });

  it('routes dialog.approval_request to dialog_approval category', () => {
    render(<AuditEventRow event={makeEvent({ eventType: 'dialog.approval_request' })} />);
    expect(screen.getByText('dialog_approval')).toBeTruthy();
  });

  it('falls back to "other" for unknown event types', () => {
    render(<AuditEventRow event={makeEvent({ eventType: 'mystery.event' })} />);
    expect(screen.getByText('other')).toBeTruthy();
  });
});

describe('AuditEventRow — unread state + markAsRead side effect', () => {
  it('renders unread indicator and calls markAsRead on mount', () => {
    render(<AuditEventRow event={makeEvent({ isRead: false })} />);
    expect(screen.getByLabelText('unread')).toBeTruthy();
    expect(markAsRead).toHaveBeenCalledWith('e1');
  });

  it('does NOT render unread indicator and does NOT call markAsRead when already read', () => {
    render(<AuditEventRow event={makeEvent({ isRead: true })} />);
    expect(screen.queryByLabelText('unread')).toBeNull();
    expect(markAsRead).not.toHaveBeenCalled();
  });
});

describe('AuditEventRow — describeEvent passes details to i18n', () => {
  it('boundary_violation surfaces tag/agent/path interpolation', () => {
    render(
      <AuditEventRow
        event={makeEvent({
          eventType: 'audit.boundary_violation',
          agentName: 'AgentA',
          tagRole: 'mytag',
          details: { violation_type: 'write', attempted_path: '/secrets/x' },
        })}
      />,
    );
    const desc = screen.getByText(/boundary_violation/, { selector: 'p' }).textContent ?? '';
    expect(desc).toContain('mytag');
    expect(desc).toContain('AgentA');
    expect(desc).toContain('/secrets/x');
  });
});
