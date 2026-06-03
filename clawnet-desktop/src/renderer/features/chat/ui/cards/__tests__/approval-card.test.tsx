// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { ApprovalCard } from '../approval-card';
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
    id: 'msg-1',
    conversationId: 'c1',
    sender: { id: 'a1', name: 'Agent', type: 'agent' },
    contentType: 'approval_request',
    content: content as ChatMessage['content'],
    timestamp: '2026-05-15T00:00:00Z',
  };
}

describe('ApprovalCard', () => {
  it('renders name + text + status badge', () => {
    render(<ApprovalCard message={makeMessage({ name: 'Deploy', text: 'Approve deploy?', status: 'pending' })} />);
    expect(screen.getByText('Deploy')).toBeTruthy();
    expect(screen.getByText('Approve deploy?')).toBeTruthy();
    expect(screen.getByText('pending')).toBeTruthy();
  });

  it('shows action buttons when pending AND a callback is wired', () => {
    render(
      <ApprovalCard
        message={makeMessage({ status: 'pending' })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Approve/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Reject/i })).toBeTruthy();
  });

  it('hides action buttons when status is not pending', () => {
    render(
      <ApprovalCard message={makeMessage({ status: 'approved' })} onApprove={vi.fn()} onReject={vi.fn()} />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('hides action buttons when pending but no callbacks (read-only degrade)', () => {
    render(<ApprovalCard message={makeMessage({ status: 'pending' })} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('approve/reject fire with content.id', () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(
      <ApprovalCard
        message={makeMessage({ id: 'approval-7', status: 'pending' })}
        onApprove={onApprove}
        onReject={onReject}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Approve/i }));
    expect(onApprove).toHaveBeenCalledWith('approval-7');
    fireEvent.click(screen.getByRole('button', { name: /Reject/i }));
    expect(onReject).toHaveBeenCalledWith('approval-7');
  });

  it('falls back to message.id when content.id is absent', () => {
    const onApprove = vi.fn();
    render(<ApprovalCard message={makeMessage({ status: 'pending' })} onApprove={onApprove} />);
    fireEvent.click(screen.getByRole('button', { name: /Approve/i }));
    expect(onApprove).toHaveBeenCalledWith('msg-1');
  });

  it('defaults status to pending when content.status is absent', () => {
    render(<ApprovalCard message={makeMessage({ name: 'X' })} onApprove={vi.fn()} />);
    expect(screen.getByText('pending')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Approve/i })).toBeTruthy();
  });
});
