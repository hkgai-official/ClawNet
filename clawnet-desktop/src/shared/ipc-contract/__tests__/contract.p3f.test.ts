// src/shared/ipc-contract/__tests__/contract.p3f.test.ts
import { describe, it, expect } from 'vitest';
import { Requests, Events } from '../index';

describe('P3F IPC contract — app.*', () => {
  it('registers app.checkForUpdates request', () => {
    expect(Requests['app.checkForUpdates']).toBeDefined();
    expect(Requests['app.checkForUpdates'].kind).toBe('request');
    const r = Requests['app.checkForUpdates'].input.safeParse({});
    expect(r.success).toBe(true);
  });

  it('registers app.quitAndInstall request', () => {
    expect(Requests['app.quitAndInstall']).toBeDefined();
    expect(Requests['app.quitAndInstall'].kind).toBe('request');
    expect(Requests['app.quitAndInstall'].input.safeParse({}).success).toBe(true);
  });

  it('registers app.updateStatus event with payload schema', () => {
    expect(Events['app.updateStatus']).toBeDefined();
    expect(Events['app.updateStatus'].kind).toBe('event');
    const result = Events['app.updateStatus'].payload.safeParse({ state: 'idle' });
    expect(result.success).toBe(true);
  });

  it('app.updateStatus event rejects unknown state', () => {
    const result = Events['app.updateStatus'].payload.safeParse({ state: 'weird' });
    expect(result.success).toBe(false);
  });
});
