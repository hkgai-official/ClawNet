import { useQuery } from '@tanstack/react-query';
import { useIpc } from '../../../hooks/use-ipc';
import type { ChatMessage } from '../../../../shared/domain/chat';
import type { Contact } from '../../../../shared/domain/contact';
import type { FileInfo } from '../../../../shared/domain/file';

export interface SearchResults {
  messages: ChatMessage[];
  contacts: Contact[];
  files: FileInfo[];
  isLoading: boolean;
  isError: boolean;
}

/**
 * Fans out the (already-debounced) query to the three global-search IPC
 * channels in parallel. TanStack Query's `enabled` gate suppresses the
 * fetch when the query is empty so we don't fire on the initial mount of
 * the search modal. Each subchannel returns its own type:
 *
 *   chat.search.messages → ChatMessage[]   (ClawNetAPI.swift:157-163)
 *   contacts.search      → Contact[]       (ClawNetAPI.swift:450-455, P2C)
 *   files.search         → FileInfo[]      (ClawNetAPI.swift:657-661)
 */
export function useGlobalSearch(debouncedQuery: string): SearchResults {
  const ipc = useIpc();
  const enabled = debouncedQuery.trim().length > 0;

  const messagesQ = useQuery({
    queryKey: ['search.messages', debouncedQuery],
    queryFn: () => ipc('chat.search.messages', { query: debouncedQuery }),
    enabled,
  });
  const contactsQ = useQuery({
    queryKey: ['search.contacts', debouncedQuery],
    queryFn: () => ipc('contacts.search', { query: debouncedQuery }),
    enabled,
  });
  const filesQ = useQuery({
    queryKey: ['search.files', debouncedQuery],
    queryFn: () => ipc('files.search', { query: debouncedQuery }),
    enabled,
  });

  return {
    messages: messagesQ.data ?? [],
    contacts: contactsQ.data ?? [],
    files: filesQ.data ?? [],
    isLoading: enabled && (messagesQ.isLoading || contactsQ.isLoading || filesQ.isLoading),
    isError: messagesQ.isError || contactsQ.isError || filesQ.isError,
  };
}
