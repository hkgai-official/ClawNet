import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();
const mockIpc = {
  handle: vi.fn((channel: string, fn: (event: unknown, payload: unknown) => Promise<unknown>) => {
    handlers.set(channel, fn);
  }),
  removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
};
vi.mock('electron', () => ({ ipcMain: mockIpc }));

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
});

describe('IpcRouter.register', () => {
  it('returns ok envelope on success', async () => {
    const { IpcRouter } = await import('../ipc-router');
    const router = new IpcRouter();
    router.register('settings.theme.get', {
      input: z.object({}),
      output: z.enum(['light', 'dark', 'system']),
      handler: async () => 'dark' as const,
    });
    const fn = handlers.get('settings.theme.get')!;
    const res = await fn({}, {});
    expect(res).toEqual({ ok: true, data: 'dark' });
  });

  it('returns err envelope when input fails zod validation', async () => {
    const { IpcRouter } = await import('../ipc-router');
    const router = new IpcRouter();
    router.register('settings.theme.set', {
      input: z.object({ theme: z.enum(['light', 'dark', 'system']) }),
      output: z.void(),
      handler: async () => undefined,
    });
    const fn = handlers.get('settings.theme.set')!;
    const res = (await fn({}, { theme: 'green' })) as { ok: false; error: { code: string } };
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('validation.input');
  });

  it('returns err envelope when handler throws', async () => {
    const { IpcRouter } = await import('../ipc-router');
    const { AppError } = await import('../error');
    const router = new IpcRouter();
    router.register('settings.theme.get', {
      input: z.object({}),
      output: z.enum(['light', 'dark', 'system']),
      handler: async () => { throw new AppError('boom', 'kaboom'); },
    });
    const fn = handlers.get('settings.theme.get')!;
    const res = (await fn({}, {})) as { ok: false; error: { code: string; message: string } };
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('boom');
    expect(res.error.message).toBe('kaboom');
  });

  it('returns err envelope when output fails zod validation', async () => {
    const { IpcRouter } = await import('../ipc-router');
    const router = new IpcRouter();
    router.register('settings.theme.get', {
      input: z.object({}),
      output: z.enum(['light', 'dark', 'system']),
      handler: async () => 'magenta' as unknown as 'dark',
    });
    const fn = handlers.get('settings.theme.get')!;
    const res = (await fn({}, {})) as { ok: false; error: { code: string } };
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('validation.output');
  });

  it('disposes all registered handlers', async () => {
    const { IpcRouter } = await import('../ipc-router');
    const router = new IpcRouter();
    router.register('settings.theme.get', {
      input: z.object({}),
      output: z.enum(['light', 'dark', 'system']),
      handler: async () => 'light' as const,
    });
    router.dispose();
    expect(mockIpc.removeHandler).toHaveBeenCalledWith('settings.theme.get');
    expect(handlers.size).toBe(0);
  });
});
