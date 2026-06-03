import { safeStorage } from 'electron';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

export class CredentialStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialStoreError';
  }
}

export type CredentialKey =
  | 'accessToken'
  | 'refreshToken'
  | 'deviceToken'
  | 'serverURL'
  | 'username'
  // JSON-stringified UserInfo. Persisted at login so restoreSession can
  // restore the full identity (id/displayName/userCode/email) without an
  // extra `/auth/me` round-trip. Without this, restoreSession fell back to
  // `{id:'restored', username:'user'}`, which made TitleBar show "user"
  // and the user's own historical messages render on the wrong side
  // (sender.id !== 'restored').
  | 'userInfo';

export class CredentialStore {
  private cache = new Map<CredentialKey, string>();

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    if (!existsSync(this.path)) return;
    if (!safeStorage.isEncryptionAvailable()) {
      throw new CredentialStoreError('safeStorage unavailable — cannot decrypt credentials');
    }
    const buf = await readFile(this.path);
    const plain = safeStorage.decryptString(buf);
    try {
      const obj = JSON.parse(plain) as Record<string, string>;
      this.cache = new Map(Object.entries(obj) as [CredentialKey, string][]);
    } catch {
      this.cache = new Map();
    }
  }

  get(key: CredentialKey): string | undefined {
    return this.cache.get(key);
  }

  set(key: CredentialKey, value: string): void {
    this.cache.set(key, value);
  }

  delete(key: CredentialKey): void {
    this.cache.delete(key);
  }

  async flush(): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      // No keychain backend (common on headless Linux CI runners without
      // gnome-keyring/kwallet, and on minimal Linux desktops). We refuse to
      // write plaintext credentials to disk, but degrade to in-memory-only:
      // the running session keeps working off this.cache, the user just
      // re-authenticates on next launch. Production macOS/Windows always
      // have a backend, so this branch only hits in CI / dev-on-headless-linux.
      console.warn(
        '[credential-store] safeStorage unavailable; running session-only ' +
        'in-memory (credentials will not persist across restarts).',
      );
      return;
    }
    const obj = Object.fromEntries(this.cache);
    const buf = safeStorage.encryptString(JSON.stringify(obj));
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, buf, { mode: 0o600 });
  }

  async clear(): Promise<void> {
    this.cache.clear();
    if (existsSync(this.path)) await rm(this.path);
  }
}
