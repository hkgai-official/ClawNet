import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIpc } from '../../../hooks/use-ipc';
import { useIpcEvent } from '../../../hooks/use-ipc-event';

export function useAgents() {
  const ipc = useIpc();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['agents.list'],
    queryFn: () => ipc('agents.list', {}),
  });
  useIpcEvent('agent.updated', () => qc.invalidateQueries({ queryKey: ['agents.list'] }));
  useIpcEvent('agent.deleted', () => qc.invalidateQueries({ queryKey: ['agents.list'] }));
  return query;
}

/** Agents reachable as A2A dialog targets — the "Pick target" list in the
 *  Agent Dialog wizard. Mirrors macOS AgentService.loadContactableAgents. */
export function useContactableAgents() {
  const ipc = useIpc();
  return useQuery({
    queryKey: ['agents.contactable'],
    queryFn: () => ipc('agents.contactable', {}),
  });
}

export function useAgent(id: string | null) {
  const ipc = useIpc();
  return useQuery({
    queryKey: ['agents.get', id],
    queryFn: async () => {
      if (!id) return null;
      return ipc('agents.get', { id });
    },
    enabled: !!id,
  });
}
