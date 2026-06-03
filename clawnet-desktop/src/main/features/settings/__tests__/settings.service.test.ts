import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { KvStore } from '../../../store/kv-store';
import { SettingsService } from '../settings.service';

class MemKv implements KvStore {
  private map = new Map<string, unknown>();
  get<T>(key: string) { return this.map.get(key) as T | undefined; }
  set(key: string, value: unknown) { this.map.set(key, value); }
  delete(key: string) { this.map.delete(key); }
  clear() { this.map.clear(); }
}

describe('SettingsService', () => {
  let kv: MemKv;
  let onChanged: ReturnType<typeof vi.fn>;
  let svc: SettingsService;

  beforeEach(() => {
    kv = new MemKv();
    onChanged = vi.fn();
    svc = new SettingsService(kv, onChanged);
  });

  it('getTheme returns "system" by default', () => {
    expect(svc.getTheme()).toBe('system');
  });

  it('setTheme persists and emits change', () => {
    svc.setTheme('dark');
    expect(svc.getTheme()).toBe('dark');
    expect(onChanged).toHaveBeenCalledWith({ theme: 'dark' });
  });

  it('getLanguage returns "en" by default', () => {
    expect(svc.getLanguage()).toBe('en');
  });

  it('setLanguage persists and emits change', () => {
    svc.setLanguage('zh-Hans');
    expect(svc.getLanguage()).toBe('zh-Hans');
    expect(onChanged).toHaveBeenCalledWith({ language: 'zh-Hans' });
  });
});
