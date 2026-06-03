export type Result<T, E = string> =
  | { ok: true; data: T }
  | { ok: false; error: { code: E; message: string; cause?: unknown } };

export const ok = <T>(data: T): Result<T, never> => ({ ok: true, data });

export const err = <E extends string>(
  code: E,
  message: string,
  cause?: unknown,
): Result<never, E> => {
  const error: { code: E; message: string; cause?: unknown } =
    cause === undefined ? { code, message } : { code, message, cause };
  return { ok: false, error };
};

export const isOk = <T, E>(r: Result<T, E>): r is { ok: true; data: T } => r.ok;
export const isErr = <T, E>(
  r: Result<T, E>,
): r is { ok: false; error: { code: E; message: string; cause?: unknown } } => !r.ok;
