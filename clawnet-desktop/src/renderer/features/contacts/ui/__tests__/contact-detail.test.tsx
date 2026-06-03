// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContactDetailView } from '../contact-detail';
import type { Contact } from '../../../../../shared/domain/contact';

const ipcMock = vi.fn();
const setActive = vi.fn();
let selectedId: string | null = null;
let contactsData: Contact[] = [];

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('../../hooks/use-contacts', () => ({
  useContacts: () => ({ data: contactsData }),
}));

vi.mock('../../state/contacts-slice', () => ({
  useContactsStore: (selector: (s: { selectedContactId: string | null }) => unknown) =>
    selector({ selectedContactId: selectedId }),
}));

vi.mock('../../../../hooks/use-ipc', () => ({
  useIpc: () => ipcMock,
}));

vi.mock('../../../chat/state/chat-slice', () => ({
  useChatStore: (selector: (s: { setActiveConversation: typeof setActive }) => unknown) =>
    selector({ setActiveConversation: setActive }),
}));

vi.mock('../../../tags/hooks/use-tags', () => ({
  useTags: () => ({ data: [{ id: 'tag-1', displayName: 'Friends' }] }),
}));

function contact(over: Partial<Contact> = {}): Contact {
  return { id: 'u-1', displayName: 'Alice', type: 'human', ...over };
}

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const rendered = render(
    <QueryClientProvider client={qc}>
      <ContactDetailView />
    </QueryClientProvider>,
  );
  return { ...rendered, qc };
}

beforeEach(() => {
  cleanup();
  ipcMock.mockReset();
  setActive.mockClear();
  selectedId = null;
  contactsData = [];
});

describe('ContactDetailView', () => {
  it('renders nothing when no contact is selected', () => {
    selectedId = null;
    const { container } = renderDetail();
    expect(container.firstChild).toBeNull();
  });

  it('shows a not-found message when the selected contact is missing', () => {
    selectedId = 'ghost';
    contactsData = [];
    renderDetail();
    expect(screen.getByText('contacts:contactNotFound')).toBeTruthy();
  });

  it('renders contact name + info rows', () => {
    selectedId = 'u-1';
    contactsData = [contact({ userCode: 'C1', email: 'a@x.test' })];
    renderDetail();
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('C1')).toBeTruthy();
    expect(screen.getByText('a@x.test')).toBeTruthy();
  });

  it('human contact: changing the tag fires the updateTag IPC', async () => {
    selectedId = 'u-1';
    contactsData = [contact()];
    ipcMock.mockResolvedValue(undefined);
    renderDetail();
    fireEvent.change(screen.getByTestId('contact-tag-select'), { target: { value: 'tag-1' } });
    // mutationFn runs on the next tick — wait for the IPC call.
    await vi.waitFor(() =>
      expect(ipcMock).toHaveBeenCalledWith('contacts.updateTag', {
        contactId: 'u-1',
        tagId: 'tag-1',
      }),
    );
  });

  it('agent contact: no tag selector is shown', () => {
    selectedId = 'u-2';
    contactsData = [contact({ id: 'u-2', type: 'agent' })];
    renderDetail();
    expect(screen.queryByTestId('contact-tag-select')).toBeNull();
  });

  it('Send Message creates a direct conversation and activates it', async () => {
    selectedId = 'u-1';
    contactsData = [contact()];
    ipcMock.mockResolvedValue({ id: 'conv-x' });
    renderDetail();
    fireEvent.click(screen.getByRole('button', { name: 'contacts:sendMessage' }));
    await vi.waitFor(() => expect(setActive).toHaveBeenCalledWith('conv-x'));
    expect(ipcMock).toHaveBeenCalledWith('chat.createDirectConversation', {
      participantId: 'u-1',
    });
  });

  it('Send Message invalidates the chat.conversations query cache', async () => {
    selectedId = 'u-1';
    contactsData = [contact()];
    ipcMock.mockResolvedValue({ id: 'conv-x' });
    const { qc } = renderDetail();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    fireEvent.click(screen.getByRole('button', { name: 'contacts:sendMessage' }));

    await vi.waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['chat.conversations'] }),
    );
    // setActive should still fire after the invalidate
    expect(setActive).toHaveBeenCalledWith('conv-x');
  });
});
