import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock electron's safeStorage with a reversible XOR "encryption" so test
// can assert encrypt/decrypt round-trip without depending on DPAPI.
function xor(buf: Buffer): Buffer {
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i]! ^ 0xa5;
  return out;
}
const mockSafeStorage = {
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((s: string) => xor(Buffer.from(s, 'utf-8'))),
  decryptString: vi.fn((b: Buffer) => xor(b).toString('utf-8')),
};
vi.mock('electron', () => ({
  safeStorage: mockSafeStorage,
  app: { getPath: () => '/unused' },
}));

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'clawnet-creds-'));
  vi.clearAllMocks();
  mockSafeStorage.isEncryptionAvailable.mockReturnValue(true);
});
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('CredentialStore', () => {
  it('round-trips access token through encrypt/decrypt to file', async () => {
    const { CredentialStore } = await import('../credential-store');
    const cs = new CredentialStore(join(tmp, 'credentials.bin'));
    await cs.load();
    cs.set('accessToken', 'abc.def.ghi');
    await cs.flush();

    const cs2 = new CredentialStore(join(tmp, 'credentials.bin'));
    await cs2.load();
    expect(cs2.get('accessToken')).toBe('abc.def.ghi');
  });

  it('returns undefined for missing keys', async () => {
    const { CredentialStore } = await import('../credential-store');
    const cs = new CredentialStore(join(tmp, 'absent.bin'));
    await cs.load();
    expect(cs.get('accessToken')).toBeUndefined();
  });

  it('delete() removes a key and flushes the file', async () => {
    const { CredentialStore } = await import('../credential-store');
    const cs = new CredentialStore(join(tmp, 'credentials.bin'));
    await cs.load();
    cs.set('accessToken', 'x');
    cs.set('refreshToken', 'y');
    await cs.flush();
    cs.delete('accessToken');
    await cs.flush();

    const cs2 = new CredentialStore(join(tmp, 'credentials.bin'));
    await cs2.load();
    expect(cs2.get('accessToken')).toBeUndefined();
    expect(cs2.get('refreshToken')).toBe('y');
  });

  it('clear() wipes everything and removes the file', async () => {
    const { CredentialStore } = await import('../credential-store');
    const cs = new CredentialStore(join(tmp, 'credentials.bin'));
    await cs.load();
    cs.set('accessToken', 'x');
    await cs.flush();
    expect(existsSync(join(tmp, 'credentials.bin'))).toBe(true);
    await cs.clear();
    expect(existsSync(join(tmp, 'credentials.bin'))).toBe(false);
  });

  it('degrades to in-memory-only when isEncryptionAvailable() is false on flush', async () => {
    // Linux CI runners without gnome-keyring/kwallet land here. We refuse
    // to write plaintext credentials, but the current session keeps working
    // out of the in-memory cache. The previous behavior (throw) broke
    // post-login state in e2e because AuthManager.login() awaits flush().
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(false);
    const { CredentialStore } = await import('../credential-store');
    const cs = new CredentialStore(join(tmp, 'credentials.bin'));
    cs.set('accessToken', 'x');
    await expect(cs.flush()).resolves.toBeUndefined();
    expect(cs.get('accessToken')).toBe('x');
    expect(existsSync(join(tmp, 'credentials.bin'))).toBe(false);
  });
});
