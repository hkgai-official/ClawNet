// src/main/features/settings/__tests__/file-access.service.test.ts
import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { FileAccessService } from '../file-access.service';
import { HttpClient } from '../../../network/http-client';
import { BookmarkStore } from '../../../store/bookmark-store';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';

const BASE = 'http://example.test:9010';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let tmp: string;
let svc: FileAccessService;
let bookmarks: BookmarkStore;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'clawnet-fa-'));
  const httpClient = new HttpClient({ baseURL: BASE, getAccessToken: async () => 'tok' });
  bookmarks = new BookmarkStore(join(tmp, 'bookmarks.json'));
  svc = new FileAccessService({ http: httpClient, bookmarks });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// Server fixture mirrors what the real server actually returns: snake_case keys
// + the 3-mode model from macOS CommandPolicy.FileAccessMode (deny|scoped|full).
const serverSettings = {
  mode: 'scoped',
  allowed_paths: ['/home/user/docs'],
  denied_paths: [],
  default_denied_paths: ['/etc', '/sys'],
};

describe('FileAccessService.syncFromServer', () => {
  it('fetches settings and caches them', async () => {
    server.use(
      http.get(`${BASE}/api/v1/file-access/settings`, () =>
        HttpResponse.json({ data: serverSettings }),
      ),
    );

    const settings = await svc.syncFromServer();
    expect(settings.mode).toBe('scoped');
    expect(settings.allowedPaths).toEqual(['/home/user/docs']);
    expect(settings.deniedPaths).toEqual([]);
    expect(settings.defaultDeniedPaths).toEqual(['/etc', '/sys']);
    expect(svc.getEffectiveSettings()).toEqual(settings);
  });

  it('fires onChanged callback after sync', async () => {
    server.use(
      http.get(`${BASE}/api/v1/file-access/settings`, () =>
        HttpResponse.json({ data: serverSettings }),
      ),
    );

    const cb = vi.fn();
    svc.onChanged(cb);
    await svc.syncFromServer();
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ mode: 'scoped' }));
  });
});

describe('FileAccessService.updateServer', () => {
  it('PUTs snake_case body and updates the cache', async () => {
    server.use(
      http.put(`${BASE}/api/v1/file-access/settings`, async ({ request }) => {
        const body = await request.json() as {
          mode: string;
          allowed_paths: string[];
          denied_paths: string[];
        };
        expect(body.mode).toBe('full');
        expect(body.allowed_paths).toEqual([]);
        expect(body.denied_paths).toEqual(['/tmp']);
        return HttpResponse.json({ data: { ...serverSettings, mode: 'full', denied_paths: ['/tmp'] } });
      }),
    );

    await svc.updateServer({ mode: 'full', allowedPaths: [], deniedPaths: ['/tmp'] });
    const cached = svc.getEffectiveSettings();
    expect(cached?.mode).toBe('full');
  });
});

describe('FileAccessService.addLocalBookmark', () => {
  it('adds entry to bookmark store and flushes', async () => {
    await svc.addLocalBookmark({ path: 'C:\\Work', label: 'work', grantedTo: ['all'] });
    // Load a fresh store from same path to confirm flush
    const fresh = new BookmarkStore(join(tmp, 'bookmarks.json'));
    await fresh.load();
    expect(fresh.list()).toHaveLength(1);
    expect(fresh.list()[0]?.path).toBe('C:\\Work');
  });
});

