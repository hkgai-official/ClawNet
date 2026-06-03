// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { AddContactModal } from '../add-contact-modal';

const sendMutate = vi.fn();
const toastPush = vi.fn();
let searchData: Array<{ id: string; displayName: string; userCode?: string }> | undefined;
let contactsData: Array<{ id: string }> = [];

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts && 'defaultValue' in opts ? (opts.defaultValue as string) : k,
  }),
}));

vi.mock('../../hooks/use-contacts', () => ({
  useContactSearch: () => ({ data: searchData, isLoading: false }),
  useContacts: () => ({ data: contactsData }),
}));

vi.mock('../../hooks/use-friend-requests', () => ({
  useSendFriendRequest: () => ({ mutate: sendMutate, isPending: false }),
}));

vi.mock('../../state/contacts-slice', () => ({
  useContactsStore: (selector: (s: { addContactModalOpen: boolean; closeAddContactModal: () => void }) => unknown) =>
    selector({ addContactModalOpen: true, closeAddContactModal: vi.fn() }),
}));

vi.mock('../../../../components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../../../components/toast-overlay', () => ({
  toastStore: { getState: () => ({ push: toastPush }) },
}));

beforeEach(() => {
  cleanup();
  sendMutate.mockReset();
  toastPush.mockClear();
  searchData = undefined;
  contactsData = [];
});

describe('AddContactModal', () => {
  it('Search is disabled until a query is typed', () => {
    render(<AddContactModal />);
    const search = screen.getByRole('button', { name: 'search' }) as HTMLButtonElement;
    expect(search.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'alice' } });
    expect(search.disabled).toBe(false);
  });

  it('renders search results and an Apply button for non-friends', () => {
    searchData = [{ id: 'u-9', displayName: 'Alice', userCode: 'C9' }];
    render(<AddContactModal />);
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText(/C9/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy();
  });

  it('shows "already friend" instead of Apply when the user is a contact', () => {
    searchData = [{ id: 'u-9', displayName: 'Alice' }];
    contactsData = [{ id: 'u-9' }];
    render(<AddContactModal />);
    expect(screen.getByText('alreadyFriend')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'apply' })).toBeNull();
  });

  it('Apply sends a friend request with the message; success toasts', () => {
    searchData = [{ id: 'u-9', displayName: 'Alice' }];
    sendMutate.mockImplementation((_v: unknown, opts: { onSuccess?: () => void }) => opts.onSuccess?.());
    render(<AddContactModal />);
    fireEvent.change(screen.getByPlaceholderText(/Say hi/), { target: { value: 'hey' } });
    fireEvent.click(screen.getByRole('button', { name: 'apply' }));
    expect(sendMutate.mock.calls[0]![0]).toEqual({ toUserId: 'u-9', message: 'hey' });
    expect(toastPush).toHaveBeenCalledWith(expect.objectContaining({ level: 'success' }));
  });

  it('Apply failure pushes an error toast', () => {
    searchData = [{ id: 'u-9', displayName: 'Alice' }];
    sendMutate.mockImplementation((_v: unknown, opts: { onError?: () => void }) => opts.onError?.());
    render(<AddContactModal />);
    fireEvent.click(screen.getByRole('button', { name: 'apply' }));
    expect(toastPush).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });
});
