import type { WebContents } from 'electron';

export class IpcEvents {
  constructor(private readonly listWebContents: () => WebContents[]) {}

  broadcast(channel: string, payload: unknown): void {
    for (const wc of this.listWebContents()) {
      if (!wc.isDestroyed()) wc.send(channel, payload);
    }
  }
}
