import { randomUUID } from 'node:crypto';

export interface DeviceIdentityStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

const KEY = 'device.id';

export function createDeviceIdentity(store: DeviceIdentityStore) {
  return {
    get(): string {
      let id = store.get(KEY);
      if (!id) {
        id = randomUUID();
        store.set(KEY, id);
      }
      return id;
    },
  };
}
