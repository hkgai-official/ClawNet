import { describe, it, expect, beforeEach } from 'vitest';
import { InstanceIdentity } from '../instance-identity';
import { createDeviceIdentity, type DeviceIdentityStore } from '../device-identity';

class MemStore implements DeviceIdentityStore {
  private map = new Map<string, string>();
  get(key: string) { return this.map.get(key); }
  set(key: string, value: string) { this.map.set(key, value); }
}

describe('InstanceIdentity', () => {
  it('returns the same id within one process', () => {
    const a = InstanceIdentity.get();
    const b = InstanceIdentity.get();
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

describe('DeviceIdentity', () => {
  let store: MemStore;
  beforeEach(() => { store = new MemStore(); });

  it('generates and persists a UUID on first call', () => {
    const id1 = createDeviceIdentity(store).get();
    expect(id1).toMatch(/^[0-9a-f-]{36}$/i);
    expect(store.get('device.id')).toBe(id1);
  });

  it('returns the persisted UUID on subsequent calls', () => {
    const ident = createDeviceIdentity(store);
    const a = ident.get();
    const b = ident.get();
    expect(a).toBe(b);
  });

  it('returns the persisted UUID across new instances on the same store', () => {
    const a = createDeviceIdentity(store).get();
    const b = createDeviceIdentity(store).get();
    expect(b).toBe(a);
  });
});
