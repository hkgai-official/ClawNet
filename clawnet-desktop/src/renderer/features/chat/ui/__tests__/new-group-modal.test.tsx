// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { NewGroupModal } from '../new-group-modal';

const createMutate = vi.fn();
const setActive = vi.fn();
const toastPush = vi.fn();
let contactsData: Array<{ id: string; displayName: string; type: 'human' | 'agent' }> = [];

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('../../../contacts/hooks/use-contacts', () => ({
  useContacts: () => ({ data: contactsData }),
}));

vi.mock('../../state/group-slice', () => ({
  useGroupStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ newGroupModalOpen: true, closeNewGroupModal: vi.fn() }),
}));

vi.mock('../../hooks/use-group', () => ({
  useCreateGroup: () => ({ mutate: createMutate, isPending: false }),
}));

vi.mock('../../state/chat-slice', () => ({
  useChatStore: (selector: (s: { setActiveConversation: typeof setActive }) => unknown) =>
    selector({ setActiveConversation: setActive }),
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
  createMutate.mockReset();
  setActive.mockClear();
  toastPush.mockClear();
  contactsData = [
    { id: 'c-1', displayName: 'Alice', type: 'human' },
    { id: 'c-2', displayName: 'Bob', type: 'human' },
    { id: 'c-3', displayName: 'Bot', type: 'agent' },
  ];
});

describe('NewGroupModal', () => {
  it('lists only human contacts (agents excluded)', () => {
    render(<NewGroupModal />);
    expect(screen.getByTestId('new-group-contact-c-1')).toBeTruthy();
    expect(screen.getByTestId('new-group-contact-c-2')).toBeTruthy();
    expect(screen.queryByTestId('new-group-contact-c-3')).toBeNull();
  });

  it('Create stays disabled until at least 2 members are selected', () => {
    render(<NewGroupModal />);
    const create = screen.getByRole('button', { name: 'group.create' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('new-group-contact-c-1'));
    expect(create.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('new-group-contact-c-2'));
    expect(create.disabled).toBe(false);
  });

  it('Create submits participantIds + optional title, then activates the group', () => {
    createMutate.mockImplementation((_v: unknown, opts: { onSuccess?: (c: { id: string }) => void }) =>
      opts.onSuccess?.({ id: 'g-new' }),
    );
    render(<NewGroupModal />);
    fireEvent.change(screen.getByPlaceholderText('group.titleOptional'), {
      target: { value: ' Team ' },
    });
    fireEvent.click(screen.getByTestId('new-group-contact-c-1'));
    fireEvent.click(screen.getByTestId('new-group-contact-c-2'));
    fireEvent.click(screen.getByRole('button', { name: 'group.create' }));
    expect(createMutate.mock.calls[0]![0]).toEqual({
      participantIds: ['c-1', 'c-2'],
      title: 'Team',
    });
    expect(setActive).toHaveBeenCalledWith('g-new');
  });

  it('Create failure pushes an error toast', () => {
    createMutate.mockImplementation((_v: unknown, opts: { onError?: () => void }) => opts.onError?.());
    render(<NewGroupModal />);
    fireEvent.click(screen.getByTestId('new-group-contact-c-1'));
    fireEvent.click(screen.getByTestId('new-group-contact-c-2'));
    fireEvent.click(screen.getByRole('button', { name: 'group.create' }));
    expect(toastPush).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });
});
