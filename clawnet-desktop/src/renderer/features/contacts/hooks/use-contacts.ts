import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useIpc } from '../../../hooks/use-ipc';

export function useContacts() {
  const ipc = useIpc();
  return useQuery({
    queryKey: ['contacts.list'],
    queryFn: () => ipc('contacts.list', {}),
  });
}

export function useContactSearch(query: string) {
  const ipc = useIpc();
  return useQuery({
    queryKey: ['contacts.search', query],
    queryFn: () => ipc('contacts.search', { query }),
    enabled: query.trim().length > 0,
  });
}

export function useAddContact() {
  const ipc = useIpc();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { contactId: string; contactType?: 'human' | 'agent' }) =>
      ipc('contacts.add', vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts.list'] }),
  });
}

export function useDeleteContact() {
  const ipc = useIpc();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contactId: string) => ipc('contacts.delete', { contactId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts.list'] }),
  });
}
