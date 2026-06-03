import { describe, it, expect } from 'vitest';
import {
  AppError,
  ApiError,
  AuthError,
  GatewayError,
  FileAccessError,
  toEnvelopeError,
} from '../error';

describe('error classes', () => {
  it('AppError carries code, message, and optional cause', () => {
    const cause = new Error('orig');
    const e = new AppError('E_GENERIC', 'something', cause);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('E_GENERIC');
    expect(e.message).toBe('something');
    expect(e.cause).toBe(cause);
  });

  it('Subclasses preserve typed code prefixes', () => {
    expect(new ApiError('http_401', 'unauth').code).toBe('api.http_401');
    expect(new AuthError('refresh_failed', 'r').code).toBe('auth.refresh_failed');
    expect(new GatewayError('disconnected', 'd').code).toBe('gateway.disconnected');
    expect(new FileAccessError('denied', 'd').code).toBe('file_access.denied');
  });

  it('toEnvelopeError converts to Result error shape', () => {
    const env = toEnvelopeError(new ApiError('http_500', 'boom'));
    expect(env.code).toBe('api.http_500');
    expect(env.message).toBe('boom');
  });

  it('toEnvelopeError handles unknown errors safely', () => {
    const env = toEnvelopeError(new Error('plain'));
    expect(env.code).toBe('unknown');
    expect(env.message).toBe('plain');
  });
});
