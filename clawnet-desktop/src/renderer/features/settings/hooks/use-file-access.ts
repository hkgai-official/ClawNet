import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useIpc } from '../../../hooks/use-ipc';
import { useIpcEvent } from '../../../hooks/use-ipc-event';
import type { FileAccessSettings } from '../../../../shared/domain/file-access';

export function useFileAccess() {
  const ipc = useIpc();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['settings.fileAccess.get'],
    queryFn: () => ipc('settings.fileAccess.get', {}),
  });

  useIpcEvent('fileAccess.changed', (s: FileAccessSettings) => {
    qc.setQueryData(['settings.fileAccess.get'], s);
  });

  return query;
}

export function useFileAccessUpdate() {
  const ipc = useIpc();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      mode: 'deny' | 'scoped' | 'full';
      allowedPaths: string[];
      deniedPaths: string[];
    }) => ipc('settings.fileAccess.update', vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings.fileAccess.get'] }),
  });
}
