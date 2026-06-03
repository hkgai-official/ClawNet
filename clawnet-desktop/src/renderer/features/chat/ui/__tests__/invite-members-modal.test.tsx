// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { InviteMembersModal } from '../invite-members-modal';

const addMutate = vi.fn();
const toastPush = vi.fn();
const closeInvite = vi.fn();
let contactsData: Array<{ id: string; displayName: string; type: 'human' | 'agent' }> = [];
let membersData: Array<{ id: string }> = [];

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('../../../contacts/hooks/use-contacts', () => ({
  useContacts: () => ({ data: contactsData }),
}));

vi.mock('../../state/group-slice', () => ({
  useGroupStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ inviteModalForConversationId: 'g-1', closeInviteModal: closeInvite }),
}));

vi.mock('../../hooks/use-group', () => ({
  useMembers: () => ({ data: membersData }),
  useAddMembers: () => ({ mutate: addMutate, isPending: false }),
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
  addMutate.mockReset();
  toastPush.mockClear();
  closeInvite.mockClear();
  contactsData = [
    { id: 'c-1', displayName: 'Alice', type: 'human' },
    { id: 'c-2', displayName: 'Bob', type: 'human' },
    { id: 'c-3', displayName: 'Bot', type: 'agent' },
  ];
  membersData = [];
});

describe('InviteMembersModal', () => {
  it('lists human candidates who are not already members', () => {
    membersData = [{ id: 'c-1' }];
    render(<InviteMembersModal />);
    expect(screen.queryByTestId('invite-contact-c-1')).toBeNull(); // already a member
    expect(screen.getByTestId('invite-contact-c-2')).toBeTruthy();
    expect(screen.queryByTestId('invite-contact-c-3')).toBeNull(); // agent
  });

  it('shows the empty hint when there are no candidates', () => {
    membersData = [{ id: 'c-1' }, { id: 'c-2' }];
    render(<InviteMembersModal />);
    expect(screen.getByText('group.noMembers')).toBeTruthy();
  });

  it('Invite is disabled until a candidate is selected', () => {
    render(<InviteMembersModal />);
    const invite = screen.getByRole('button', { name: 'group.invite' }) as HTMLButtonElement;
    expect(invite.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('invite-contact-c-1'));
    expect(invite.disabled).toBe(false);
  });

  it('Invite submits the selected ids; success closes the modal', () => {
    addMutate.mockImplementation((_ids: string[], opts: { onSuccess?: () => void }) => opts.onSuccess?.());
    render(<InviteMembersModal />);
    fireEvent.click(screen.getByTestId('invite-contact-c-1'));
    fireEvent.click(screen.getByTestId('invite-contact-c-2'));
    fireEvent.click(screen.getByRole('button', { name: 'group.invite' }));
    expect(addMutate.mock.calls[0]![0]).toEqual(['c-1', 'c-2']);
    expect(closeInvite).toHaveBeenCalled();
  });

  it('Invite failure pushes an error toast', () => {
    addMutate.mockImplementation((_ids: string[], opts: { onError?: () => void }) => opts.onError?.());
    render(<InviteMembersModal />);
    fireEvent.click(screen.getByTestId('invite-contact-c-1'));
    fireEvent.click(screen.getByRole('button', { name: 'group.invite' }));
    expect(toastPush).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });
});
