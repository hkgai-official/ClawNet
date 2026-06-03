// src/main/features/settings/file-access.service.ts
import { z } from 'zod';
import type { HttpClient } from '../../network/http-client';
import type { BookmarkStore } from '../../store/bookmark-store';
import type { FileAccessSettings } from '../../../shared/domain/file-access';

const ServerSettingsSchema = z.object({
  mode: z.enum(['deny', 'scoped', 'full']),
  allowedPaths: z.array(z.string()),
  deniedPaths: z.array(z.string()),
  defaultDeniedPaths: z.array(z.string()),
});

const SettingsResponseSchema = z.object({
  data: ServerSettingsSchema,
});

function fromServer(raw: z.infer<typeof ServerSettingsSchema>): FileAccessSettings {
  return {
    mode: raw.mode,
    allowedPaths: raw.allowedPaths,
    deniedPaths: raw.deniedPaths,
    defaultDeniedPaths: raw.defaultDeniedPaths,
  };
}

export interface FileAccessServiceOptions {
  http: HttpClient;
  bookmarks: BookmarkStore;
}

export class FileAccessService {
  private cache: FileAccessSettings | null = null;
  private changedCb: ((s: FileAccessSettings) => void) | null = null;

  constructor(private readonly opts: FileAccessServiceOptions) {}

  async syncFromServer(): Promise<FileAccessSettings> {
    const raw = await this.opts.http.getJson<unknown>('/api/v1/file-access/settings');
    const parsed = SettingsResponseSchema.parse(raw);
    const settings = fromServer(parsed.data);
    this.cache = settings;
    this.changedCb?.(settings);
    return settings;
  }

  async updateServer({
    mode,
    allowedPaths,
    deniedPaths,
  }: {
    mode: FileAccessSettings['mode'];
    allowedPaths: string[];
    deniedPaths: string[];
  }): Promise<void> {
    const raw = await this.opts.http.putJson<unknown>('/api/v1/file-access/settings', {
      mode,
      allowedPaths,
      deniedPaths,
    });
    const parsed = SettingsResponseSchema.parse(raw);
    this.cache = fromServer(parsed.data);
  }

  async addLocalBookmark({
    path,
    label,
    grantedTo,
  }: {
    path: string;
    label?: string;
    grantedTo: string[];
  }): Promise<void> {
    const bmEntry: { path: string; label?: string; grantedTo: string[] } = { path, grantedTo };
    if (label !== undefined) bmEntry.label = label;
    this.opts.bookmarks.add(bmEntry);
    await this.opts.bookmarks.flush();
  }

  getEffectiveSettings(): FileAccessSettings | null {
    return this.cache;
  }

  /** Drop the in-memory server-settings cache. The next
   *  `getEffectiveSettings()` returns null until `syncFromServer()`
   *  runs again (which happens automatically after gateway connect). */
  clearCache(): void {
    this.cache = null;
  }

  onChanged(cb: (s: FileAccessSettings) => void): void {
    this.changedCb = cb;
  }
}
