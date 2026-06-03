import { ipcMain } from 'electron';
import type { ZodTypeAny, z } from 'zod';
import { toEnvelopeError } from './error';
import type { Result } from '../../shared/result';

export interface RouteSpec<I extends ZodTypeAny, O extends ZodTypeAny> {
  input: I;
  output: O;
  handler: (input: z.infer<I>) => Promise<z.infer<O>>;
}

export class IpcRouter {
  private channels = new Set<string>();

  register<I extends ZodTypeAny, O extends ZodTypeAny>(
    channel: string,
    spec: RouteSpec<I, O>,
  ): void {
    this.channels.add(channel);
    ipcMain.handle(channel, async (_event, raw): Promise<Result<unknown, string>> => {
      const inputResult = spec.input.safeParse(raw);
      if (!inputResult.success) {
        return {
          ok: false,
          error: {
            code: 'validation.input',
            message: inputResult.error.message,
          },
        };
      }
      try {
        const output = await spec.handler(inputResult.data);
        const outputResult = spec.output.safeParse(output);
        if (!outputResult.success) {
          return {
            ok: false,
            error: {
              code: 'validation.output',
              message: outputResult.error.message,
            },
          };
        }
        return { ok: true, data: outputResult.data };
      } catch (e) {
        return { ok: false, error: toEnvelopeError(e) };
      }
    });
  }

  dispose(): void {
    for (const ch of this.channels) ipcMain.removeHandler(ch);
    this.channels.clear();
  }
}
