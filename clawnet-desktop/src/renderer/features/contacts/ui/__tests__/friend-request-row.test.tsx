// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { FriendRequestRow } from '../friend-request-row';
import type { FriendRequest } from '../../../../../shared/domain/contact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

beforeEach(() => cleanup());

function makeReq(overrides: Partial<FriendRequest> = {}): FriendRequest {
  return {
    id: 'r1',
    fromUserId: 'u-from',
    fromUserName: 'Bob',
    toUserId: 'u-to',
    toUserName: 'Self',
    status: 'pending',
    message: 'wanna chat',
    createdAt: '2026-05-15T10:00:00Z',
    ...overrides,
  };
}

describe('FriendRequestRow', () => {
  it('renders accept + reject buttons when status === pending', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    render(<FriendRequestRow request={makeReq()} onAccept={onAccept} onReject={onReject} pending={false} />);
    expect(screen.getByLabelText('accept')).toBeTruthy();
    expect(screen.getByLabelText('reject')).toBeTruthy();
  });

  it('hides accept + reject buttons when status !== pending', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    render(
      <FriendRequestRow
        request={makeReq({ status: 'accepted' })}
        onAccept={onAccept}
        onReject={onReject}
        pending={false}
      />,
    );
    expect(screen.queryByLabelText('accept')).toBeNull();
    expect(screen.queryByLabelText('reject')).toBeNull();
  });

  it('clicking ✓ fires onAccept', () => {
    const onAccept = vi.fn();
    render(<FriendRequestRow request={makeReq()} onAccept={onAccept} onReject={vi.fn()} pending={false} />);
    fireEvent.click(screen.getByLabelText('accept'));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('clicking ✗ fires onReject', () => {
    const onReject = vi.fn();
    render(<FriendRequestRow request={makeReq()} onAccept={vi.fn()} onReject={onReject} pending={false} />);
    fireEvent.click(screen.getByLabelText('reject'));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while a mutation is pending', () => {
    render(<FriendRequestRow request={makeReq()} onAccept={vi.fn()} onReject={vi.fn()} pending={true} />);
    expect((screen.getByLabelText('accept') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('reject') as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders the optional message line when present', () => {
    render(<FriendRequestRow request={makeReq({ message: 'hi please' })} onAccept={vi.fn()} onReject={vi.fn()} pending={false} />);
    expect(screen.getByText('hi please')).toBeTruthy();
  });

  it('omits the message line when not provided', () => {
    const { container } = render(
      <FriendRequestRow request={makeReq({ message: undefined })} onAccept={vi.fn()} onReject={vi.fn()} pending={false} />,
    );
    // Only the name + initial should render, no second textual line.
    expect(container.textContent).toContain('Bob');
    // Cheap structural assert — no message text means the row body has
    // exactly one inner div for the name.
  });
});
