import { z } from 'zod';
import { defineRequest } from './_common';

export const ShellRequests = {
  /** Open a local path in the OS default application (Electron shell.openPath).
   *  Returns ok: false + error string on failure instead of throwing so the
   *  renderer can show an inline error without a crash boundary. */
  'shell.openPath': defineRequest({
    input: z.object({ path: z.string() }),
    output: z.object({ ok: z.boolean(), error: z.string().optional() }),
  }),
  /** Reveal a local path in the OS file explorer (Electron shell.showItemInFolder).
   *  Mirrors macOS NSWorkspace.selectFile. Returns ok: false + error message
   *  when the underlying call throws (e.g. missing path). */
  'shell.showItemInFolder': defineRequest({
    input: z.object({ path: z.string() }),
    output: z.object({ ok: z.boolean(), error: z.string().optional() }),
  }),
} as const;

export const ShellEvents = {} as const;
