import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.mock` is hoisted, so this stub is in place before the dynamic import below.
vi.mock('electron', () => ({
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
}));

import { shell } from 'electron';
import { registerShellHandlers } from '../shell.handlers';

interface HandlerSpec {
  handler: (input: unknown) => Promise<unknown>;
}

function makeRouter(): {
  router: { register: (n: string, def: HandlerSpec) => void };
  handlers: Map<string, HandlerSpec>;
} {
  const handlers = new Map<string, HandlerSpec>();
  const router = {
    register: (n: string, def: HandlerSpec) => {
      handlers.set(n, def);
    },
  };
  return { router, handlers };
}

beforeEach(() => {
  vi.mocked(shell.openPath).mockReset();
  vi.mocked(shell.showItemInFolder).mockReset();
});

describe('shell.openPath handler', () => {
  it('returns ok:true when Electron returns empty string (success)', async () => {
    vi.mocked(shell.openPath).mockResolvedValueOnce('');
    const { router, handlers } = makeRouter();
    registerShellHandlers(router as never);
    const result = await handlers.get('shell.openPath')!.handler({ path: '/x/y' });
    expect(result).toEqual({ ok: true });
    expect(shell.openPath).toHaveBeenCalledWith('/x/y');
  });

  it('returns ok:false + error when Electron returns an error string', async () => {
    vi.mocked(shell.openPath).mockResolvedValueOnce('no such file');
    const { router, handlers } = makeRouter();
    registerShellHandlers(router as never);
    const result = await handlers.get('shell.openPath')!.handler({ path: '/x/y' });
    expect(result).toEqual({ ok: false, error: 'no such file' });
  });
});

describe('shell.showItemInFolder handler', () => {
  it('calls Electron shell.showItemInFolder with the path and returns ok:true', async () => {
    vi.mocked(shell.showItemInFolder).mockReturnValueOnce(undefined);
    const { router, handlers } = makeRouter();
    registerShellHandlers(router as never);
    const result = await handlers.get('shell.showItemInFolder')!.handler({ path: '/x/y/file.pdf' });
    expect(result).toEqual({ ok: true });
    expect(shell.showItemInFolder).toHaveBeenCalledWith('/x/y/file.pdf');
  });

  it('returns ok:false + error message when Electron throws', async () => {
    vi.mocked(shell.showItemInFolder).mockImplementationOnce(() => {
      throw new Error('path not found');
    });
    const { router, handlers } = makeRouter();
    registerShellHandlers(router as never);
    const result = await handlers.get('shell.showItemInFolder')!.handler({ path: '/missing' });
    expect(result).toEqual({ ok: false, error: 'path not found' });
  });
});
