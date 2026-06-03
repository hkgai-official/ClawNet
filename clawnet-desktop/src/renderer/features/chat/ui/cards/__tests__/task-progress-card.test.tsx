// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { TaskProgressCard } from '../task-progress-card';
import type { ChatMessage } from '../../../../../../shared/domain/chat';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts && 'defaultValue' in opts ? (opts.defaultValue as string) : k,
  }),
}));

beforeEach(() => cleanup());

function makeMessage(content: Record<string, unknown>): ChatMessage {
  return {
    id: 'm1',
    conversationId: 'c1',
    sender: { id: 'a1', name: 'Agent', type: 'agent' },
    contentType: 'task_progress',
    content: content as ChatMessage['content'],
    timestamp: '2026-05-15T00:00:00Z',
  };
}

describe('TaskProgressCard', () => {
  it('renders an error fallback for an invalid payload', () => {
    render(<TaskProgressCard message={makeMessage({ nope: 1 })} />);
    expect(screen.getByText(/payload invalid/i)).toBeTruthy();
  });

  it('renders stage + percentage for a 0..1 fraction', () => {
    render(<TaskProgressCard message={makeMessage({ taskId: 't1', stage: 'Scanning', progress: 0.5 })} />);
    expect(screen.getByText('Scanning')).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
  });

  it('normalizes a 0..100 integer progress to a percentage', () => {
    render(<TaskProgressCard message={makeMessage({ taskId: 't1', stage: 'X', progress: 80 })} />);
    expect(screen.getByText('80%')).toBeTruthy();
  });

  it('renders the details map sorted by key', () => {
    render(
      <TaskProgressCard
        message={makeMessage({
          taskId: 't1',
          stage: 'X',
          progress: 0.1,
          details: { zeta: 'last', alpha: 'first' },
        })}
      />,
    );
    expect(screen.getByText('alpha')).toBeTruthy();
    expect(screen.getByText('first')).toBeTruthy();
    expect(screen.getByText('zeta')).toBeTruthy();
  });
});
