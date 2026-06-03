import { describe, it, expect } from 'vitest';
import { deriveBlobEndpoint } from '../blob-endpoint';

describe('deriveBlobEndpoint', () => {
  it('converts ws:// → http://', () => {
    const ep = deriveBlobEndpoint('ws://localhost:8080/api/v1/ws', 'tok');
    expect(ep.baseURL).toBe('http://localhost:8080/api/v1/ws');
    expect(ep.token).toBe('tok');
  });

  it('converts wss:// → https://', () => {
    const ep = deriveBlobEndpoint('wss://example.com/api/v1/ws', 'tok');
    expect(ep.baseURL).toBe('https://example.com/api/v1/ws');
  });

  it('preserves port', () => {
    const ep = deriveBlobEndpoint('wss://example.com:9443/path', 'tok');
    expect(ep.baseURL).toBe('https://example.com:9443/path');
  });

  it('preserves query string (mirrors macOS URLComponents behavior)', () => {
    const ep = deriveBlobEndpoint('ws://h:1/api/v1/ws?token=abc', 'tok');
    expect(ep.baseURL).toBe('http://h:1/api/v1/ws?token=abc');
  });

  it('allows undefined token', () => {
    const ep = deriveBlobEndpoint('ws://h:1/', undefined);
    expect(ep.token).toBeUndefined();
  });
});
