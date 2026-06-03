// Gateway-specific handshake token cache. NOT for user-session tokens
// (those live in CredentialStore via safeStorage). See spec §6.3 / §3.3.
interface KvLite {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): void;
}

const KEY = 'gateway.deviceTokens';

export class DeviceAuthStore {
  private cache: Record<string, string>;

  constructor(private readonly kv: KvLite) {
    this.cache = kv.get<Record<string, string>>(KEY) ?? {};
  }

  getToken(gatewayURL: string, deviceId: string): string | undefined {
    return this.cache[this.composite(gatewayURL, deviceId)];
  }

  setToken(gatewayURL: string, deviceId: string, token: string): void {
    this.cache[this.composite(gatewayURL, deviceId)] = token;
    this.kv.set(KEY, this.cache);
  }

  clear(): void {
    this.cache = {};
    this.kv.set(KEY, this.cache);
  }

  private composite(gatewayURL: string, deviceId: string): string {
    return `${gatewayURL}::${deviceId}`;
  }
}
