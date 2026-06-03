import { describe, it, expect, vi } from 'vitest';
import { IpcEvents } from '../ipc-events';

describe('IpcEvents.broadcast', () => {
  it('calls webContents.send with channel and payload on each window', () => {
    const wc1 = { send: vi.fn(), isDestroyed: () => false };
    const wc2 = { send: vi.fn(), isDestroyed: () => false };
    const events = new IpcEvents(() => [wc1, wc2] as never);
    events.broadcast('settings.changed', { theme: 'dark' });
    expect(wc1.send).toHaveBeenCalledWith('settings.changed', { theme: 'dark' });
    expect(wc2.send).toHaveBeenCalledWith('settings.changed', { theme: 'dark' });
  });

  it('skips destroyed webContents', () => {
    const alive = { send: vi.fn(), isDestroyed: () => false };
    const dead = { send: vi.fn(), isDestroyed: () => true };
    const events = new IpcEvents(() => [alive, dead] as never);
    events.broadcast('settings.changed', { language: 'en' });
    expect(alive.send).toHaveBeenCalled();
    expect(dead.send).not.toHaveBeenCalled();
  });
});
