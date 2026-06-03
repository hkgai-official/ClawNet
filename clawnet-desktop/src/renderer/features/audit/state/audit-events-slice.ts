// src/renderer/features/audit/state/audit-events-slice.ts
//
// Local cache of audit events. Mirrors macOS AuditService.swift:31-108:
//   - WS push (`audit.event`) inserts at the head (newest first), capped at 500.
//   - REST list (`audit.events.list`) merges by id and preserves local `isRead`
//     state for events we already have — matches Swift loadEvents() merge.
//   - mark-as-read is local-only (macOS does not persist it server-side).

import { create } from 'zustand';
import type { AuditEvent } from '../../../../shared/domain/audit';

const MAX_EVENTS = 500;

interface AuditEventsSlice {
  events: AuditEvent[];
  addFromPush: (event: AuditEvent) => void;
  mergeFromList: (events: AuditEvent[]) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
}

export const useAuditEventsStore = create<AuditEventsSlice>((set) => ({
  events: [],

  addFromPush: (event) => set((state) => {
    // Upsert in place if id exists (preserves position).
    const idx = state.events.findIndex((e) => e.id === event.id);
    if (idx >= 0) {
      const next = state.events.slice();
      next[idx] = event;
      return { events: next };
    }
    // Otherwise insert at head and cap.
    const next = [event, ...state.events];
    if (next.length > MAX_EVENTS) next.length = MAX_EVENTS;
    return { events: next };
  }),

  mergeFromList: (incoming) => set((state) => {
    // Preserve local isRead for ids we already have.
    const localById = new Map(state.events.map((e) => [e.id, e]));
    const merged: AuditEvent[] = [];
    const seen = new Set<string>();
    for (const ev of incoming) {
      const local = localById.get(ev.id);
      merged.push(local ? { ...ev, isRead: local.isRead } : ev);
      seen.add(ev.id);
    }
    for (const ev of state.events) {
      if (!seen.has(ev.id)) merged.push(ev);
    }
    // Sort newest first by timestamp string (ISO-8601 sorts correctly).
    merged.sort((a, b) => (b.timestamp > a.timestamp ? 1 : b.timestamp < a.timestamp ? -1 : 0));
    if (merged.length > MAX_EVENTS) merged.length = MAX_EVENTS;
    return { events: merged };
  }),

  markAsRead: (id) => set((state) => {
    const idx = state.events.findIndex((e) => e.id === id);
    if (idx < 0) return state;
    const next = state.events.slice();
    next[idx] = { ...next[idx]!, isRead: true };
    return { events: next };
  }),

  markAllAsRead: () => set((state) => ({
    events: state.events.map((e) => (e.isRead ? e : { ...e, isRead: true })),
  })),
}));

/** Derived selector — call inside a component to subscribe to unread count. */
export function selectUnreadCount(state: AuditEventsSlice): number {
  return state.events.reduce((sum, e) => (e.isRead ? sum : sum + 1), 0);
}
