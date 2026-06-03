// src/renderer/features/audit/state/__tests__/audit-events-slice.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAuditEventsStore } from '../audit-events-slice';
import type { AuditEvent } from '../../../../../shared/domain/audit';

function makeEvent(id: string, opts: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id,
    eventType: opts.eventType ?? 'audit.access_denied',
    timestamp: opts.timestamp ?? '2026-05-12T00:00:00Z',
    details: opts.details ?? {},
    isRead: opts.isRead ?? false,
    ...opts,
  } as AuditEvent;
}

beforeEach(() => {
  useAuditEventsStore.setState({ events: [] });
});

describe('audit-events-slice', () => {
  it('starts empty', () => {
    expect(useAuditEventsStore.getState().events).toEqual([]);
  });

  describe('addFromPush', () => {
    it('inserts new events at the head (newest first)', () => {
      const s = useAuditEventsStore.getState();
      s.addFromPush(makeEvent('a'));
      s.addFromPush(makeEvent('b'));
      expect(useAuditEventsStore.getState().events.map((e) => e.id)).toEqual(['b', 'a']);
    });

    it('caps the cache at 500 (drops oldest)', () => {
      const s = useAuditEventsStore.getState();
      for (let i = 0; i < 510; i++) s.addFromPush(makeEvent(`ev-${i}`));
      const { events } = useAuditEventsStore.getState();
      expect(events).toHaveLength(500);
      expect(events[0]?.id).toBe('ev-509');
      expect(events[499]?.id).toBe('ev-10');
    });

    it('treats duplicate id as upsert (replaces in place, preserves position)', () => {
      const s = useAuditEventsStore.getState();
      s.addFromPush(makeEvent('a', { details: { v: '1' } }));
      s.addFromPush(makeEvent('b'));
      s.addFromPush(makeEvent('a', { details: { v: '2' } }));
      const { events } = useAuditEventsStore.getState();
      expect(events.map((e) => e.id)).toEqual(['b', 'a']);
      expect(events[1]?.details.v).toBe('2');
    });
  });

  describe('mergeFromList', () => {
    it('appends server events that we do not have', () => {
      const s = useAuditEventsStore.getState();
      s.addFromPush(makeEvent('local-1'));
      s.mergeFromList([makeEvent('server-1'), makeEvent('server-2')]);
      const ids = useAuditEventsStore.getState().events.map((e) => e.id);
      expect(ids).toContain('local-1');
      expect(ids).toContain('server-1');
      expect(ids).toContain('server-2');
    });

    it('preserves local isRead state when server returns an event we already have', () => {
      const s = useAuditEventsStore.getState();
      s.addFromPush(makeEvent('a', { isRead: false }));
      s.markAsRead('a');
      s.mergeFromList([makeEvent('a', { isRead: true })]);
      const a = useAuditEventsStore.getState().events.find((e) => e.id === 'a');
      expect(a?.isRead).toBe(true);
    });

    it('sorts merged result newest-first by timestamp', () => {
      const s = useAuditEventsStore.getState();
      s.mergeFromList([
        makeEvent('a', { timestamp: '2026-05-10T00:00:00Z' }),
        makeEvent('b', { timestamp: '2026-05-12T00:00:00Z' }),
        makeEvent('c', { timestamp: '2026-05-11T00:00:00Z' }),
      ]);
      expect(useAuditEventsStore.getState().events.map((e) => e.id)).toEqual(['b', 'c', 'a']);
    });
  });

  describe('markAsRead / markAllAsRead', () => {
    it('marks a single event as read', () => {
      const s = useAuditEventsStore.getState();
      s.addFromPush(makeEvent('a'));
      s.addFromPush(makeEvent('b'));
      s.markAsRead('a');
      const { events } = useAuditEventsStore.getState();
      expect(events.find((e) => e.id === 'a')?.isRead).toBe(true);
      expect(events.find((e) => e.id === 'b')?.isRead).toBe(false);
    });

    it('marks all events as read', () => {
      const s = useAuditEventsStore.getState();
      s.addFromPush(makeEvent('a'));
      s.addFromPush(makeEvent('b'));
      s.markAllAsRead();
      expect(useAuditEventsStore.getState().events.every((e) => e.isRead)).toBe(true);
    });

    it('is a no-op for unknown id', () => {
      const s = useAuditEventsStore.getState();
      s.addFromPush(makeEvent('a'));
      s.markAsRead('does-not-exist');
      expect(useAuditEventsStore.getState().events).toHaveLength(1);
    });
  });
});
