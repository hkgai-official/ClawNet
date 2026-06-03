import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';

const mockApp = {
  setPath: vi.fn(),
  getPath: vi.fn(),
};
vi.mock('electron', () => ({ app: mockApp }));

beforeEach(() => {
  vi.clearAllMocks();
  mockApp.getPath.mockImplementation((key: string) => {
    if (key === 'userData') return 'C:\\Users\\u\\AppData\\Local\\ClawNet';
    if (key === 'home') return 'C:\\Users\\u';
    if (key === 'downloads') return 'C:\\Users\\u\\Downloads';
    throw new Error(`unknown key: ${key}`);
  });
});

describe('AppPaths', () => {
  it('initialize() sets userData to %LOCALAPPDATA%\\ClawNet before any other path access', async () => {
    process.env.LOCALAPPDATA = 'C:\\Users\\u\\AppData\\Local';
    const { AppPaths } = await import('../paths');
    AppPaths.initialize();
    expect(mockApp.setPath).toHaveBeenCalledWith(
      'userData',
      join('C:\\Users\\u\\AppData\\Local', 'ClawNet'),
    );
  });

  it('logs() returns userData/logs', async () => {
    const { AppPaths } = await import('../paths');
    expect(AppPaths.logs()).toBe(join('C:\\Users\\u\\AppData\\Local\\ClawNet', 'logs'));
  });

  it('credentialsFile() returns userData/credentials.bin', async () => {
    const { AppPaths } = await import('../paths');
    expect(AppPaths.credentialsFile()).toBe(
      join('C:\\Users\\u\\AppData\\Local\\ClawNet', 'credentials.bin'),
    );
  });

  it('fileAccessJson() returns userData/file_access.json', async () => {
    const { AppPaths } = await import('../paths');
    expect(AppPaths.fileAccessJson()).toBe(
      join('C:\\Users\\u\\AppData\\Local\\ClawNet', 'file_access.json'),
    );
  });

  it('downloadsServerConfig() returns Downloads/server-config.json', async () => {
    const { AppPaths } = await import('../paths');
    expect(AppPaths.downloadsServerConfig()).toBe(
      join('C:\\Users\\u\\Downloads', 'server-config.json'),
    );
  });

  it('initialize() honors CLAWNET_USER_DATA_DIR override (e2e hook)', async () => {
    process.env.CLAWNET_USER_DATA_DIR = '/custom/path/ClawNet-E2E';
    vi.resetModules();
    const { AppPaths } = await import('../paths');
    AppPaths.initialize();
    expect(mockApp.setPath).toHaveBeenCalledWith('userData', '/custom/path/ClawNet-E2E');
    delete process.env.CLAWNET_USER_DATA_DIR;
  });

  it('initialize() falls back to app.getPath("appData") if LOCALAPPDATA is missing (cross-platform safety)', async () => {
    delete process.env.LOCALAPPDATA;
    mockApp.getPath.mockImplementation((key: string) => {
      if (key === 'appData') return '/Users/u/Library/Application Support';
      if (key === 'userData') return '/Users/u/Library/Application Support/ClawNet';
      if (key === 'downloads') return '/Users/u/Downloads';
      if (key === 'home') return '/Users/u';
      throw new Error(`unknown key: ${key}`);
    });
    vi.resetModules();
    const { AppPaths } = await import('../paths');
    AppPaths.initialize();
    expect(mockApp.setPath).toHaveBeenCalledWith(
      'userData',
      join('/Users/u/Library/Application Support', 'ClawNet'),
    );
  });

  it('mediaCache() returns userData/media-cache', async () => {
    vi.resetModules();
    const { AppPaths } = await import('../paths');
    expect(AppPaths.mediaCache()).toBe(
      join('C:\\Users\\u\\AppData\\Local\\ClawNet', 'media-cache'),
    );
  });
});
