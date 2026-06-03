// src/main/features/update/update.service.ts
//
// Wraps electron-updater's autoUpdater. Forwards its event stream as a
// state-machine envelope (UpdateStatus). Treats 404-from-GitHub-Releases
// (empty release feed) as 'no-update' rather than 'error'.

import type { UpdateStatus } from '../../../shared/domain/update-status';

export interface UpdaterLike {
  on(event: string, cb: (...args: unknown[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
  autoDownload?: boolean;
}

type StatusListener = (s: UpdateStatus) => void;

export interface UpdateServiceOptions {
  updater: UpdaterLike;
}

const NOT_FOUND_PATTERNS = [/HttpError:\s*404/i, /\bnot[_\s-]?found\b/i];

function isEmptyReleaseFeedError(err: unknown): boolean {
  if (!err) return false;
  const msg = typeof err === 'string' ? err : (err as { message?: string }).message ?? '';
  return NOT_FOUND_PATTERNS.some((re) => re.test(msg));
}

export class UpdateService {
  private readonly listeners = new Set<StatusListener>();
  private latest: UpdateStatus = { state: 'idle' };
  private latestVersion: string | undefined;
  private started = false;

  constructor(private readonly opts: UpdateServiceOptions) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    const u = this.opts.updater;
    u.autoDownload = true;
    u.on('checking-for-update', () => this.push({ state: 'checking' }));
    u.on('update-available', (info: unknown) => {
      const version = (info as { version?: string } | undefined)?.version;
      this.latestVersion = version;
      const status: UpdateStatus = { state: 'available' };
      if (version) status.version = version;
      this.push(status);
    });
    u.on('update-not-available', () => this.push({ state: 'no-update' }));
    u.on('download-progress', (progress: unknown) => {
      const percent = (progress as { percent?: number } | undefined)?.percent ?? 0;
      const status: UpdateStatus = { state: 'downloading', progressPercent: percent };
      if (this.latestVersion) status.version = this.latestVersion;
      this.push(status);
    });
    u.on('update-downloaded', (info: unknown) => {
      const version = (info as { version?: string } | undefined)?.version ?? this.latestVersion;
      const status: UpdateStatus = { state: 'downloaded' };
      if (version) status.version = version;
      this.push(status);
    });
    u.on('error', (err: unknown) => {
      if (isEmptyReleaseFeedError(err)) {
        this.push({ state: 'no-update' });
        return;
      }
      const msg = (err as { message?: string } | undefined)?.message ?? String(err);
      this.push({ state: 'error', error: msg });
    });
  }

  async checkForUpdates(): Promise<UpdateStatus> {
    // Capture the next terminal-ish status that follows this call. We can't
    // rely on this.latest being updated synchronously after checkForUpdates()
    // resolves — electron-updater emits its events asynchronously and the
    // mock harness uses setTimeout(0). Subscribe BEFORE invoking so we don't
    // miss a synchronous emit.
    const nextStatus = new Promise<UpdateStatus>((resolve) => {
      const unsub = this.onStatusChange((s) => {
        if (
          s.state === 'available' ||
          s.state === 'no-update' ||
          s.state === 'downloaded' ||
          s.state === 'error'
        ) {
          unsub();
          resolve(s);
        }
      });
    });
    try {
      await this.opts.updater.checkForUpdates();
    } catch (err) {
      if (isEmptyReleaseFeedError(err)) {
        const status: UpdateStatus = { state: 'no-update' };
        this.push(status);
        return status;
      }
      const status: UpdateStatus = {
        state: 'error',
        error: (err as { message?: string } | undefined)?.message ?? String(err),
      };
      this.push(status);
      return status;
    }
    return nextStatus;
  }

  quitAndInstall(): void {
    this.opts.updater.quitAndInstall();
  }

  onStatusChange(cb: StatusListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  current(): UpdateStatus {
    return this.latest;
  }

  private push(s: UpdateStatus): void {
    this.latest = s;
    for (const cb of this.listeners) cb(s);
  }
}
