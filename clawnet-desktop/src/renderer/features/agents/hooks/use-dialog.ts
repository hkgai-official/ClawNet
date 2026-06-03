import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useIpc } from '../../../hooks/use-ipc';
import { useIpcEvent } from '../../../hooks/use-ipc-event';
import type { DialogSession } from '../../../../shared/domain/dialog';

export function useDialogByConversation(conversationId: string | null) {
  const ipc = useIpc();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['dialogs.getByConv', conversationId],
    queryFn: async () => {
      if (!conversationId) return null;
      return ipc('dialogs.getByConv', { conversationId });
    },
    enabled: !!conversationId,
  });

  const patch = useCallback(
    (session: DialogSession) => {
      if (session.conversationId !== conversationId) return;
      qc.setQueryData(['dialogs.getByConv', conversationId], session);
    },
    [qc, conversationId],
  );

  // dialog.draft.updated has a different shape now (accumulator payload
  // for the dialog-draft-slice, not a full DialogSession). Listen to it in
  // useDialogDraft(sessionId) inside the renderer instead.
  useIpcEvent('dialog.completed', patch);

  // Partial-update push: status_change / paused / terminated /
  // round_complete all funnel here. Merge into the cached session.
  useIpcEvent('dialog.status.changed', (p) => {
    if (!conversationId) return;
    qc.setQueryData<DialogSession | null>(
      ['dialogs.getByConv', conversationId],
      (prev) => {
        if (!prev || prev.id !== p.sessionId) return prev ?? null;
        const next: DialogSession = { ...prev };
        // Status is a constrained enum at rest, but the wire side is a
        // free string. Cast through unknown to satisfy exactOptionalPropertyTypes.
        if (p.status !== undefined) (next as { status: unknown }).status = p.status;
        if (p.currentRound !== undefined) next.currentRound = p.currentRound;
        if (p.maxRounds !== undefined) next.maxRounds = p.maxRounds;
        if (p.terminationReason !== undefined) next.terminationReason = p.terminationReason;
        return next;
      },
    );
  });

  return query;
}

export function useDialogActions(sessionId: string) {
  const ipc = useIpc();

  const approve = useMutation({
    mutationFn: (vars: { approved: boolean; reason?: string }) =>
      ipc('dialogs.approve', { sessionId, ...vars }),
  });

  const requestMain = useMutation({
    mutationFn: () => ipc('dialogs.requestMain', { sessionId }),
  });

  const refine = useMutation({
    mutationFn: (vars: { target: string; instruction: string }) =>
      ipc('dialogs.refine', { sessionId, ...vars }),
  });

  const submitResponse = useMutation({
    mutationFn: (vars: { text: string }) =>
      ipc('dialogs.submitResponse', { sessionId, ...vars }),
  });

  const terminate = useMutation({
    mutationFn: (vars?: { reason?: string }) =>
      ipc('dialogs.terminate', { sessionId, ...vars }),
  });

  const extend = useMutation({
    mutationFn: (vars: { additionalRounds: number }) =>
      ipc('dialogs.extend', { sessionId, ...vars }),
  });

  return { approve, requestMain, refine, submitResponse, terminate, extend };
}

