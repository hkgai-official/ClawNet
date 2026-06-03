export class AppError extends Error {
  readonly code: string;
  override readonly cause?: unknown;
  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export class ApiError extends AppError {
  constructor(subcode: string, message: string, cause?: unknown) {
    super(`api.${subcode}`, message, cause);
  }
}

export class AuthError extends AppError {
  constructor(subcode: string, message: string, cause?: unknown) {
    super(`auth.${subcode}`, message, cause);
  }
}

export class GatewayError extends AppError {
  constructor(subcode: string, message: string, cause?: unknown) {
    super(`gateway.${subcode}`, message, cause);
  }
}

export class FileAccessError extends AppError {
  constructor(subcode: string, message: string, cause?: unknown) {
    super(`file_access.${subcode}`, message, cause);
  }
}

export interface EnvelopeError {
  code: string;
  message: string;
  cause?: unknown;
}

export function toEnvelopeError(e: unknown): EnvelopeError {
  if (e instanceof AppError) {
    return e.cause !== undefined
      ? { code: e.code, message: e.message, cause: e.cause }
      : { code: e.code, message: e.message };
  }
  if (e instanceof Error) {
    return { code: 'unknown', message: e.message, cause: e };
  }
  return { code: 'unknown', message: String(e) };
}
