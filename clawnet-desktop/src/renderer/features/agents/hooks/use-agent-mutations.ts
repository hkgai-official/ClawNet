import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useIpc } from '../../../hooks/use-ipc';
import type { AgentConfig } from '../../../../shared/domain/agent';

// Matches useAgents() queryKey in src/renderer/features/agents/hooks/use-agents.ts.
const AGENTS_LIST_KEY = ['agents.list'] as const;

export function useCreateAgent() {
  const ipc = useIpc();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { config: AgentConfig; tagId?: string; tagRole?: string }) =>
      ipc('agents.create', vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: AGENTS_LIST_KEY }),
  });
}

export function useUpdateAgent() {
  const ipc = useIpc();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; config: AgentConfig; tagId?: string; tagRole?: string }) =>
      ipc('agents.update', vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: AGENTS_LIST_KEY }),
  });
}

export function useDeleteAgent() {
  const ipc = useIpc();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipc('agents.delete', { id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: AGENTS_LIST_KEY }),
  });
}
