// src/main/features/notifications/notification.service.ts
//
// 1:1 port of macOS NotificationService.swift (lines 1-54).
//
// Skeleton-only: macOS instantiates the service in AppState but never wires
// it to chat events (showMessageNotification has no caller). The Win port
// mirrors that staleness exactly — instantiated in main/index.ts but no
// triggers. Refreshing this into an actually-firing notification path is a
// separate phase (P3D-trigger-wire-up).

import { Notification } from 'electron';

/**
 * E2E and offscreen modes suppress all desktop notifications — we don't
 * want the host user to see toaster popups while Playwright drives the
 * app, and an offscreen app shouldn't visibly notify either. Any of
 * these env vars being '1' switches NotificationService into no-op mode
 * (showMessageNotification doesn't construct an actual Notification).
 */
function isHeadlessLike(): boolean {
  return (
    process.env.CLAWNET_E2E_OFFSCREEN === '1' ||
    process.env.CLAWNET_E2E_NO_FOCUS === '1' ||
    process.env.CLAWNET_DISABLE_NOTIFICATIONS === '1'
  );
}

export class NotificationService {
  // Tracked notifications grouped by conversation id, so clearNotifications
  // can dismiss them programmatically. Electron's Notification API does not
  // expose a per-thread query (unlike macOS UNUserNotificationCenter), so
  // we maintain this map ourselves.
  private readonly tracked = new Map<string, Notification[]>();
  // E2E observation log: when running headless we suppress the OS-level
  // Notification but still record each call so e2e specs can assert the
  // wiring fires. Exposed read-only via getEmittedLog(); the renderer
  // never sees this (it's main-process only).
  private readonly emittedLog: Array<{
    senderName: string;
    body: string;
    conversationId: string;
    at: number;
  }> = [];

  /** Read-only view of suppressed/fired notifications for e2e specs.
   *  Always populated, regardless of headless mode. */
  getEmittedLog(): ReadonlyArray<{
    senderName: string;
    body: string;
    conversationId: string;
    at: number;
  }> {
    return this.emittedLog;
  }

  /**
   * Windows Action Center handles user-facing permission state outside the
   * app. We surface a `true` when the platform supports Notifications at
   * all, matching the macOS API shape without prompting the user.
   */
  async requestPermission(): Promise<boolean> {
    return Notification.isSupported();
  }

  showMessageNotification(senderName: string, body: string, conversationId: string): void {
    this.emittedLog.push({ senderName, body, conversationId, at: Date.now() });
    if (isHeadlessLike()) return;
    const n = new Notification({ title: senderName, body });
    n.show();
    const list = this.tracked.get(conversationId) ?? [];
    list.push(n);
    this.tracked.set(conversationId, list);
  }

  clearNotifications(conversationId: string): void {
    const list = this.tracked.get(conversationId);
    if (!list) return;
    for (const n of list) n.close();
    this.tracked.delete(conversationId);
  }
}
