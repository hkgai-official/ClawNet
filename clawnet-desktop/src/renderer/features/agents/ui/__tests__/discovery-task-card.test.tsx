// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import { DiscoveryTaskCard } from '../discovery-task-card';
import type { DiscoveryTask } from '../../../../../shared/domain/discovery';

const confirmMutate = vi.fn();
const cancelMutate = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      // Surface interpolated placeholders so assertions can grep for them.
      if (opts && typeof opts === 'object') {
        let out = k;
        for (const [key, val] of Object.entries(opts)) {
          if (key === 'defaultValue') continue;
          out += `:${val as string}`;
        }
        return out;
      }
      return k;
    },
  }),
}));

vi.mock('../../hooks/use-discovery', () => ({
  useDiscoveryActions: () => ({
    confirm: { mutate: confirmMutate, isPending: false },
    cancel: { mutate: cancelMutate, isPending: false },
  }),
}));

beforeEach(() => {
  cleanup();
  confirmMutate.mockClear();
  cancelMutate.mockClear();
});

function makeTask(overrides: Partial<DiscoveryTask> = {}): DiscoveryTask {
  return {
    id: 't1',
    sourceConversationId: 'c1',
    initiatorAgentId: 'a1',
    initiatorOwnerId: 'u1',
    status: 'pending_confirmation',
    originalIntent: 'find a python expert',
    maxHops: 3,
    currentHopCount: 1,
    maxConcurrent: 2,
    pendingQueries: [],
    completedResults: [],
    activeSessions: [],
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    completedAt: null,
    ...overrides,
  };
}

describe('DiscoveryTaskCard', () => {
  it('renders title + intent', () => {
    render(<DiscoveryTaskCard task={makeTask()} />);
    expect(screen.getByText('discovery.cardTitle')).toBeTruthy();
    expect(screen.getByText('find a python expert')).toBeTruthy();
  });

  it('shows Confirm + Cancel buttons in pending_confirmation', () => {
    render(<DiscoveryTaskCard task={makeTask({ status: 'pending_confirmation' })} />);
    expect(screen.getByText('discovery.confirm')).toBeTruthy();
    expect(screen.getByText('discovery.cancel')).toBeTruthy();
  });

  it('hides Confirm but keeps Cancel while running', () => {
    render(<DiscoveryTaskCard task={makeTask({ status: 'running' })} />);
    expect(screen.queryByText('discovery.confirm')).toBeNull();
    expect(screen.getByText('discovery.cancel')).toBeTruthy();
  });

  it('hides both actions when completed (not active)', () => {
    render(<DiscoveryTaskCard task={makeTask({ status: 'completed' })} />);
    expect(screen.queryByText('discovery.confirm')).toBeNull();
    expect(screen.queryByText('discovery.cancel')).toBeNull();
  });

  it('clicking Confirm fires confirm.mutate({id})', () => {
    render(<DiscoveryTaskCard task={makeTask({ id: 'task-xx' })} />);
    fireEvent.click(screen.getByText('discovery.confirm'));
    expect(confirmMutate).toHaveBeenCalledWith({ id: 'task-xx' });
  });

  it('clicking Cancel fires cancel.mutate({id})', () => {
    render(<DiscoveryTaskCard task={makeTask({ id: 'task-yy' })} />);
    fireEvent.click(screen.getByText('discovery.cancel'));
    expect(cancelMutate).toHaveBeenCalledWith({ id: 'task-yy' });
  });

  it('shows hop count when maxHops > 1', () => {
    const { container } = render(
      <DiscoveryTaskCard task={makeTask({ maxHops: 5, currentHopCount: 2 })} />,
    );
    // The mock t() surfaces interpolations as `key:current:max`; check substring.
    expect(container.textContent).toMatch(/discovery\.hopCount.*2.*5/);
  });

  it('omits hop count when maxHops is 1', () => {
    const { container } = render(
      <DiscoveryTaskCard task={makeTask({ maxHops: 1 })} />,
    );
    expect(container.textContent).not.toMatch(/discovery\.hopCount/);
  });

  it('renders completed-results section with owner + summary', () => {
    render(
      <DiscoveryTaskCard
        task={makeTask({
          status: 'running',
          completedResults: [
            { target_owner: 'Alice', summary: 'has 8 yrs python', status: 'completed' },
          ],
        })}
      />,
    );
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('has 8 yrs python')).toBeTruthy();
  });

  it('renders active-sessions section with contacting label', () => {
    const { container } = render(
      <DiscoveryTaskCard
        task={makeTask({
          status: 'running',
          activeSessions: [{ target_owner: 'Bob', topic: 'react' }],
        })}
      />,
    );
    expect(container.textContent).toMatch(/discovery\.contacting.*Bob/);
    expect(screen.getByText('react')).toBeTruthy();
  });

  it('renders pending-queries section with pendingContact label', () => {
    const { container } = render(
      <DiscoveryTaskCard
        task={makeTask({
          status: 'pending_confirmation',
          pendingQueries: [{ target_owner: 'Carol', topic: 'rust' }],
        })}
      />,
    );
    expect(container.textContent).toMatch(/discovery\.pendingContact.*Carol/);
  });

  it('progress percent = completed / total', () => {
    const { container } = render(
      <DiscoveryTaskCard
        task={makeTask({
          status: 'running',
          completedResults: [{ target_owner: 'A' }, { target_owner: 'B' }],
          activeSessions: [{ target_owner: 'C' }],
          pendingQueries: [{ target_owner: 'D' }],
        })}
      />,
    );
    // 2 / 4 = 50%
    expect(container.textContent).toContain('50%');
  });
});
