// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NewChatModal } from '../new-chat-modal';

const ipcMock = vi.fn();
const setActive = vi.fn();
const toastPush = vi.fn();
const openNewGroupModal = vi.fn();
let contactsData: Array<{ id: string; displayName: string; type: 'human' | 'agent' }> = [];

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts && 'defaultValue' in opts ? (opts.defaultValue as string) : k,
  }),
}));

vi.mock('../../../contacts/hooks/use-contacts', () => ({
  useContacts: () => ({ data: contactsData }),
}));

vi.mock('../../../../hooks/use-ipc', () => ({
  useIpc: () => ipcMock,
}));

vi.mock('../../state/group-slice', () => ({
  useGroupStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      newChatModalOpen: true,
      closeNewChatModal: vi.fn(),
      openNewGroupModal,
      openAgentDialogWizard: vi.fn(),
    }),
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

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NewChatModal />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cleanup();
  ipcMock.mockReset();
  setActive.mockClear();
  toastPush.mockClear();
  openNewGroupModal.mockClear();
  contactsData = [
    { id: 'c-1', displayName: 'Alice', type: 'human' },
    { id: 'c-2', displayName: 'Bot', type: 'agent' },
  ];
});

describe('NewChatModal', () => {
  it('renders the contact list', () => {
    renderModal();
    expect(screen.getByTestId('new-chat-contact-c-1')).toBeTruthy();
    expect(screen.getByTestId('new-chat-contact-c-2')).toBeTruthy();
  });

  it('shows an empty state when there are no contacts', () => {
    contactsData = [];
    renderModal();
    expect(screen.getByText(/No contacts yet/)).toBeTruthy();
  });

  it('Create is disabled until a contact is selected', () => {
    renderModal();
    const create = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('new-chat-contact-c-1'));
    expect(create.disabled).toBe(false);
  });

  it('Create calls createDirectConversation and activates the result', async () => {
    ipcMock.mockResolvedValue({ id: 'conv-new' });
    renderModal();
    fireEvent.click(screen.getByTestId('new-chat-contact-c-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(ipcMock).toHaveBeenCalledWith('chat.createDirectConversation', {
        participantId: 'c-1',
      }),
    );
    await waitFor(() => expect(setActive).toHaveBeenCalledWith('conv-new'));
  });

  it('Create failure pushes an error toast', async () => {
    ipcMock.mockRejectedValue(new Error('nope'));
    renderModal();
    fireEvent.click(screen.getByTestId('new-chat-contact-c-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(toastPush).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' })),
    );
  });

  it('Create Group hands off to the group modal', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Create Group' }));
    expect(openNewGroupModal).toHaveBeenCalledTimes(1);
  });
});
