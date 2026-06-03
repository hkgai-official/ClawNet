import { describe, it, expect, beforeEach } from 'vitest';
import { DeviceAuthStore } from '../device-auth-store';

interface KvLite {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
}
class MemKv implements KvLite {
  private map = new Map<string, unknown>();
  get<T>(k: string) { return this.map.get(k) as T | undefined; }
  set(k: string, v: unknown) { this.map.set(k, v); }
}

let kv: MemKv;
beforeEach(() => { kv = new MemKv(); });

describe('DeviceAuthStore', () => {
  it('returns undefined for unknown gateway+device pair', () => {
    const s = new DeviceAuthStore(kv);
    expect(s.getToken('gw1', 'dev1')).toBeUndefined();
  });

  it('persists and reads back per (gatewayURL, deviceId)', () => {
    const s = new DeviceAuthStore(kv);
    s.setToken('gw1', 'dev1', 't1');
    s.setToken('gw1', 'dev2', 't2');
    s.setToken('gw2', 'dev1', 't3');
    expect(s.getToken('gw1', 'dev1')).toBe('t1');
    expect(s.getToken('gw1', 'dev2')).toBe('t2');
    expect(s.getToken('gw2', 'dev1')).toBe('t3');
  });

  it('persists across new instances on the same kv', () => {
    new DeviceAuthStore(kv).setToken('gw1', 'dev1', 't1');
    expect(new DeviceAuthStore(kv).getToken('gw1', 'dev1')).toBe('t1');
  });

  it('clear() drops all entries', () => {
    const s = new DeviceAuthStore(kv);
    s.setToken('gw1', 'dev1', 't1');
    s.clear();
    expect(s.getToken('gw1', 'dev1')).toBeUndefined();
  });
});
