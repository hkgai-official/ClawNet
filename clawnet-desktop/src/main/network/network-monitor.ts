import dns from 'node:dns/promises';

export interface NetworkMonitorOptions {
  intervalMs?: number;
  probeHost?: string;
}

export class NetworkMonitor {
  private interval: NodeJS.Timeout | null = null;
  private online = true;
  private restoredCallbacks: Array<() => void> = [];
  private lostCallbacks: Array<() => void> = [];

  constructor(private readonly opts: NetworkMonitorOptions = {}) {}

  async start(): Promise<void> {
    if (this.interval) return;
    this.online = await this.probe();
    this.interval = setInterval(() => { void this.tick(); }, this.opts.intervalMs ?? 5000);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  isOnline(): boolean {
    return this.online;
  }

  onRestored(cb: () => void): void { this.restoredCallbacks.push(cb); }
  onLost(cb: () => void): void { this.lostCallbacks.push(cb); }

  private async tick(): Promise<void> {
    const nowOnline = await this.probe();
    if (nowOnline && !this.online) {
      this.online = true;
      for (const cb of this.restoredCallbacks) cb();
    } else if (!nowOnline && this.online) {
      this.online = false;
      for (const cb of this.lostCallbacks) cb();
    }
  }

  private async probe(): Promise<boolean> {
    try {
      await dns.lookup(this.opts.probeHost ?? '1.1.1.1');
      return true;
    } catch {
      return false;
    }
  }
}
