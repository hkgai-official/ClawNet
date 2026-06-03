// src/main/features/notifications/__tests__/notification.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationService } from '../notification.service';

// Spy on Electron's Notification class. Mock the whole 'electron' module
// so tests don't drag in the real app runtime.
const mockNotificationCtor = vi.fn();
const showSpy = vi.fn();
const closeSpy = vi.fn();
const onSpy = vi.fn();

vi.mock('electron', () => ({
  Notification: Object.assign(
    vi.fn().mockImplementation((opts: unknown) => {
      mockNotificationCtor(opts);
      return {
        show: showSpy,
        close: closeSpy,
        on: onSpy,
      };
    }),
    { isSupported: vi.fn().mockReturnValue(true) },
  ),
}));

beforeEach(() => {
  mockNotificationCtor.mockClear();
  showSpy.mockClear();
  closeSpy.mockClear();
  onSpy.mockClear();
});

describe('NotificationService (1:1 from NotificationService.swift)', () => {
  describe('requestPermission', () => {
    it('returns true when Notification is supported', async () => {
      const svc = new NotificationService();
      await expect(svc.requestPermission()).resolves.toBe(true);
    });

    it('returns false when Notification.isSupported() is false', async () => {
      const { Notification } = await import('electron');
      (Notification.isSupported as unknown as { mockReturnValueOnce: (v: boolean) => void })
        .mockReturnValueOnce(false);
      const svc = new NotificationService();
      await expect(svc.requestPermission()).resolves.toBe(false);
    });
  });

  describe('showMessageNotification', () => {
    it('creates a Notification with title=senderName + body=preview and calls show()', () => {
      const svc = new NotificationService();
      svc.showMessageNotification('Alice', 'Hello there', 'conv-1');
      expect(mockNotificationCtor).toHaveBeenCalledWith({
        title: 'Alice',
        body: 'Hello there',
      });
      expect(showSpy).toHaveBeenCalledTimes(1);
    });

    it('tracks notifications per conversationId so clearNotifications can dismiss them', () => {
      const svc = new NotificationService();
      svc.showMessageNotification('Alice', 'msg1', 'conv-1');
      svc.showMessageNotification('Alice', 'msg2', 'conv-1');
      svc.showMessageNotification('Bob',   'other', 'conv-2');
      svc.clearNotifications('conv-1');
      // Both conv-1 notifications closed; conv-2 untouched.
      expect(closeSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('clearNotifications', () => {
    it('is a no-op for an unknown conversationId', () => {
      const svc = new NotificationService();
      svc.clearNotifications('does-not-exist');
      expect(closeSpy).not.toHaveBeenCalled();
    });

    it('empties the tracking map after clearing', () => {
      const svc = new NotificationService();
      svc.showMessageNotification('Alice', 'msg', 'conv-1');
      svc.clearNotifications('conv-1');
      // Second clear should be a no-op (map empty) — close not called again.
      svc.clearNotifications('conv-1');
      expect(closeSpy).toHaveBeenCalledTimes(1);
    });
  });
});
