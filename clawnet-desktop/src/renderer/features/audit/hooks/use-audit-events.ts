// src/renderer/features/audit/hooks/use-audit-events.ts
//
// Drives audit-events-slice:
//   1. On mount, fetch initial page via `audit.events.list` (mirrors macOS
//      AuditService.swift:71-89 loadEvents).
//   2. Subscribe to `audit.event` IPC event for incremental WS pushes
//      (mirrors AuditService.handleAuditEvent at swift line 26-46).
// Returns nothing — consumers read from `useAuditEventsStore` directly.

import { useCallback, useEffect, useRef } from 'react';
import { useIpc } from '../../../hooks/use-ipc';
import { useIpcEvent } from '../../../hooks/use-ipc-event';
import { useAuditEventsStore } from '../state/audit-events-slice';
import type { AuditEvent } from '../../../../shared/domain/audit';

const PAGE_SIZE = 100;

export function useAuditEvents(): void {
  const ipc = useIpc();
  const merge = useAuditEventsStore((s) => s.mergeFromList);
  const addPush = useAuditEventsStore((s) => s.addFromPush);
  const loadedRef = useRef(false);

  // Initial REST load — once per mount (StrictMode double-invoke safe).
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void ipc('audit.events.list', { limit: PAGE_SIZE, offset: 0 })
      .then((events) => {
        merge(events);
      })
      .catch((err) => {
        // Audit-list load failed (e.g. main-side schema drift). Surface to
        // the dev console so the tab being empty doesn't look like a backend
        // issue. Slice stays empty; user can switch tabs and back to retry.
        console.error('[audit] failed to load initial events:', err);
      });
  }, [ipc, merge]);

  // Live WS push subscription. Stable handler keeps useIpcEvent's effect from
  // resubscribing on every render.
  const handlePush = useCallback(
    (event: AuditEvent) => {
      addPush(event);
    },
    [addPush],
  );
  useIpcEvent('audit.event', handlePush);
}
