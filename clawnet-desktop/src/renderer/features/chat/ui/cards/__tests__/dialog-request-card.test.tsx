// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { DialogRequestCard } from '../dialog-request-card';
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
    contentType: 'dialog_request',
    content: content as ChatMessage['content'],
    timestamp: '2026-05-15T00:00:00Z',
  };
}

describe('DialogRequestCard', () => {
  it('renders an error fallback for an invalid payload', () => {
    render(<DialogRequestCard message={makeMessage({ garbage: true })} />);
    expect(screen.getByText(/payload invalid/i)).toBeTruthy();
  });

  it('renders topic + my→target agents + contact tag', () => {
    render(
      <DialogRequestCard
        message={makeMessage({
          status: 'pending',
          topic: 'sync up',
          myAgent: { displayName: 'My Agent' },
          targetAgent: { displayName: 'Their Agent' },
          contactTag: { displayName: 'friends' },
        })}
      />,
    );
    expect(screen.getByText('sync up')).toBeTruthy();
    expect(screen.getByText('My Agent')).toBeTruthy();
    expect(screen.getByText('Their Agent')).toBeTruthy();
    expect(screen.getByText('friends')).toBeTruthy();
  });

  it('status confirmed → Confirmed badge', () => {
    render(<DialogRequestCard message={makeMessage({ status: 'confirmed' })} />);
    expect(screen.getByText('Confirmed')).toBeTruthy();
  });

  it('status cancelled → Rejected badge', () => {
    render(<DialogRequestCard message={makeMessage({ status: 'cancelled' })} />);
    expect(screen.getByText('Rejected')).toBeTruthy();
  });

  it('unknown status → Waiting badge', () => {
    render(<DialogRequestCard message={makeMessage({ status: 'pending' })} />);
    expect(screen.getByText('Waiting…')).toBeTruthy();
  });
});
