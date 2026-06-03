// src/main/features/update/__tests__/update.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { UpdateService } from '../update.service';
import type { UpdateStatus } from '../../../../shared/domain/update-status';

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  checkForUpdates = vi.fn(async () => undefined);
  quitAndInstall = vi.fn();
}

let updater: FakeUpdater;
let svc: UpdateService;
let history: UpdateStatus[];

beforeEach(() => {
  updater = new FakeUpdater();
  svc = new UpdateService({ updater });
  history = [];
  svc.onStatusChange((s) => history.push(s));
  svc.start();
});

describe('UpdateService event mapping', () => {
  it('checking-for-update → status.checking', () => {
    updater.emit('checking-for-update');
    expect(history.at(-1)).toEqual({ state: 'checking' });
  });

  it('update-available → status.available with version', () => {
    updater.emit('update-available', { version: '0.18.1' });
    expect(history.at(-1)).toEqual({ state: 'available', version: '0.18.1' });
  });

  it('update-not-available → status.no-update', () => {
    updater.emit('update-not-available');
    expect(history.at(-1)).toEqual({ state: 'no-update' });
  });

  it('download-progress → status.downloading with progressPercent', () => {
    updater.emit('update-available', { version: '0.18.1' });
    updater.emit('download-progress', { percent: 42.3 });
    expect(history.at(-1)).toEqual({
      state: 'downloading', version: '0.18.1', progressPercent: 42.3,
    });
  });

  it('update-downloaded → status.downloaded with version', () => {
    updater.emit('update-available', { version: '0.18.1' });
    updater.emit('update-downloaded', { version: '0.18.1' });
    expect(history.at(-1)).toEqual({ state: 'downloaded', version: '0.18.1' });
  });
});

describe('UpdateService error handling', () => {
  it('error with 404 message → status.no-update (graceful empty-feed)', () => {
    updater.emit('error', new Error('HttpError: 404 Not Found'));
    expect(history.at(-1)).toEqual({ state: 'no-update' });
  });

  it('error with "not_found" → status.no-update', () => {
    updater.emit('error', new Error('not_found: latest.yml missing'));
    expect(history.at(-1)).toEqual({ state: 'no-update' });
  });

  it('error with other message → status.error with message', () => {
    updater.emit('error', new Error('ECONNRESET'));
    expect(history.at(-1)).toEqual({ state: 'error', error: 'ECONNRESET' });
  });
});

describe('UpdateService.start idempotency', () => {
  it('calling start() twice does not double-subscribe (only one event per emit)', () => {
    svc.start(); // second call — should be a no-op
    updater.emit('checking-for-update');
    expect(history.filter((s) => s.state === 'checking')).toHaveLength(1);
  });
});

describe('UpdateService.checkForUpdates', () => {
  it('invokes updater.checkForUpdates() and returns the next status', async () => {
    const promise = svc.checkForUpdates();
    setTimeout(() => updater.emit('update-not-available'), 0);
    const result = await promise;
    expect(result.state).toBe('no-update');
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('resolves with error status on uncaught checkForUpdates() rejection', async () => {
    updater.checkForUpdates.mockRejectedValueOnce(new Error('boom'));
    const result = await svc.checkForUpdates();
    expect(result.state).toBe('error');
    expect(result.error).toBe('boom');
  });
});

describe('UpdateService.quitAndInstall', () => {
  it('delegates to updater.quitAndInstall()', () => {
    svc.quitAndInstall();
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });
});
