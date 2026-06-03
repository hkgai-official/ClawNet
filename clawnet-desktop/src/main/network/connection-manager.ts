import type { NetworkMonitor } from './network-monitor';
import type { ConnectionStatus } from '../../shared/domain/auth';

export interface ConnectionManagerOptions {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  networkMonitor: NetworkMonitor;
  backoffMs?: number[];
}

export interface StatusEvent {
  status: ConnectionStatus;
  lastError: string | null;
  reconnectAttempt: number;
}

const DEFAULT_BACKOFF = [500, 1000, 2000, 5000, 10000, 30000];

export class ConnectionManager {
  private _status: ConnectionStatus = 'disconnected';
  private lastError: string | null = null;
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private listeners: Array<(e: StatusEvent) => void> = [];

  constructor(private readonly opts: ConnectionManagerOptions) {
    opts.networkMonitor.onRestored(() => {
      if (this._status === 'reconnecting' && !this.reconnectTimer) {
        this.scheduleReconnect(0);
      }
    });
    opts.networkMonitor.onLost(() => {
      if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    });
  }

  status(): ConnectionStatus { return this._status; }
  attemptCount(): number { return this.attempt; }
  onStatusChanged(cb: (e: StatusEvent) => void): void { this.listeners.push(cb); }

  async connect(): Promise<void> {
    this.setStatus('connecting');
    try {
      await this.opts.connect();
      this.attempt = 0;
      this.lastError = null;
      this.setStatus('connected');
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      console.error('[ConnectionManager] connect failed (attempt', this.attempt + '):', this.lastError, e instanceof Error ? e.stack : '');
      this.setStatus('reconnecting');
      this.scheduleReconnect();
      throw e;
    }
  }

  handleDisconnect(reason: string): void {
    if (this._status === 'disconnected') return;
    this.lastError = reason;
    this.setStatus('reconnecting');
    this.scheduleReconnect();
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    await this.opts.disconnect();
    this.attempt = 0;
    this.lastError = null;
    this.setStatus('disconnected');
  }

  manualReconnect(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.attempt = 0;
    void this.connect().catch(() => {});
  }

  private scheduleReconnect(forceDelayMs?: number): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (!this.opts.networkMonitor.isOnline()) return;
    const backoff = this.opts.backoffMs ?? DEFAULT_BACKOFF;
    const idx = Math.min(this.attempt, backoff.length - 1);
    const delay = forceDelayMs ?? backoff[idx]!;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.attempt += 1;
      void this.connect().catch(() => {});
    }, delay);
  }

  private setStatus(s: ConnectionStatus): void {
    this._status = s;
    for (const cb of this.listeners) {
      cb({ status: s, lastError: this.lastError, reconnectAttempt: this.attempt });
    }
  }
}
