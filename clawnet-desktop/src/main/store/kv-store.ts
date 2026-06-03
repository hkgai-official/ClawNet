import Store from 'electron-store';

export interface KvStore {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  clear(): void;
}

export interface KvStoreOptions {
  cwd: string;
  name: string;
}

export function createKvStore(opts: KvStoreOptions): KvStore {
  const store = new Store<Record<string, unknown>>({
    cwd: opts.cwd,
    name: opts.name,
    fileExtension: 'json',
  });
  return {
    get: <T>(key: string) => store.get(key) as T | undefined,
    set: (key, value) => store.set(key, value),
    delete: (key) => store.delete(key),
    clear: () => store.clear(),
  };
}
