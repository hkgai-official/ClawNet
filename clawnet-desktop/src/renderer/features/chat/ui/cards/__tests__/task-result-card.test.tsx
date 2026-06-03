// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { TaskResultCard } from '../task-result-card';
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
    contentType: 'task_result',
    content: content as ChatMessage['content'],
    timestamp: '2026-05-15T00:00:00Z',
  };
}

describe('TaskResultCard', () => {
  it('renders an error fallback for an invalid payload', () => {
    render(<TaskResultCard message={makeMessage({ bad: true })} />);
    expect(screen.getByText(/payload invalid/i)).toBeTruthy();
  });

  it('success → Completed header + summary', () => {
    render(<TaskResultCard message={makeMessage({ taskId: 't1', success: true, summary: 'all good' })} />);
    expect(screen.getByText('Completed')).toBeTruthy();
    expect(screen.getByText('all good')).toBeTruthy();
  });

  it('failure → Failed header + error pane', () => {
    render(
      <TaskResultCard
        message={makeMessage({ taskId: 't1', success: false, summary: 'oops', error: 'disk full' })}
      />,
    );
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByText('disk full')).toBeTruthy();
  });

  it('details collapsed by default; toggle reveals filesProcessed + logs', () => {
    render(
      <TaskResultCard
        message={makeMessage({
          taskId: 't1',
          success: true,
          summary: 's',
          details: { filesProcessed: 12, logs: ['line one', 'line two'] },
        })}
      />,
    );
    // Collapsed: details content hidden.
    expect(screen.queryByText('line one')).toBeNull();
    const toggle = screen.getByRole('button', { name: /Details/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('line one')).toBeTruthy();
    expect(screen.getByText('line two')).toBeTruthy();
  });

  it('no details → no Details toggle', () => {
    render(<TaskResultCard message={makeMessage({ taskId: 't1', success: true, summary: 's' })} />);
    expect(screen.queryByRole('button', { name: /Details/i })).toBeNull();
  });
});
