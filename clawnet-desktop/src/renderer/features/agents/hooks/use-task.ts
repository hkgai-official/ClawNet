import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useIpc } from '../../../hooks/use-ipc';
import { useIpcEvent } from '../../../hooks/use-ipc-event';
import type { ServerTask, ExecutionLog } from '../../../../shared/domain/task';

export function useTask(id: string | null) {
  const ipc = useIpc();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['tasks.get', id],
    queryFn: async () => {
      if (!id) return null;
      return ipc('tasks.get', { id });
    },
    enabled: !!id,
  });

  const patch = useCallback(
    (task: ServerTask) => {
      if (task.id !== id) return;
      qc.setQueryData(['tasks.get', id], task);
    },
    [qc, id],
  );

  useIpcEvent('task.statusChanged', patch);

  return query;
}

export function useTaskLogs(id: string | null) {
  const ipc = useIpc();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['tasks.getLogs', id],
    queryFn: async () => {
      if (!id) return [] as ExecutionLog[];
      return ipc('tasks.getLogs', { id });
    },
    enabled: !!id,
  });

  const appendLog = useCallback(
    (e: { taskId: string; log: ExecutionLog }) => {
      if (e.taskId !== id) return;
      qc.setQueryData(['tasks.getLogs', id], (prev: ExecutionLog[] | undefined) => {
        const logs = prev ?? [];
        return [...logs, e.log];
      });
    },
    [qc, id],
  );

  useIpcEvent('task.log.appended', appendLog);

  return query;
}

export function useTaskActions() {
  const ipc = useIpc();

  const approve = useMutation({
    mutationFn: (vars: { id: string; decision: 'approve' | 'reject' | 'modify'; modifications?: string }) =>
      ipc('tasks.approve', vars),
  });

  const cancel = useMutation({
    mutationFn: (vars: { id: string }) =>
      ipc('tasks.cancel', vars),
  });

  return { approve, cancel };
}
