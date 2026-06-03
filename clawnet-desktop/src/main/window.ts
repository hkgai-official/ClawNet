import { BrowserWindow, nativeImage, nativeTheme } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWindowState, saveWindowState, type WindowState } from './store/window-state';

/** Resolve the path to the bundled app icon for the dev/runtime window.
 *  In packaged builds Electron picks the icon from the executable's
 *  resources (electron-builder.win.icon), so this only affects dev mode
 *  and the in-window taskbar tooltip. */
function resolveAppIconPath(): string | undefined {
  // The renderer bundle sits one directory above main; the resources
  // directory is two up from `out/main`.
  const candidates = [
    join(__dirname, '../../resources/icon.png'),
    join(__dirname, '../../../resources/icon.png'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SAVE_DEBOUNCE_MS = 500;

export async function createMainWindow(userDataDir: string): Promise<BrowserWindow> {
  const isDark = nativeTheme.shouldUseDarkColors;
  const overlayBg = isDark ? '#0a0a0b' : '#fafafa';
  const overlaySymbol = isDark ? '#fafafa' : '#18181b';

  // When running under Playwright e2e (CLAWNET_E2E_OFFSCREEN=1), position the
  // window far off-screen so the host user isn't distracted by app instances
  // popping in and out as specs run. Size + DOM behaviour are unchanged, so
  // Playwright's renderer-driven assertions work exactly the same.
  //
  // Restricted to darwin: on Linux+xvfb (CI) the virtual display geometry is
  // small (commonly 1024x768) and a window positioned at (-32000,-32000) has
  // no on-screen area to render into, which makes the renderer never paint
  // and every `toBeVisible()` assertion time out. xvfb itself already hides
  // the window from any human, so no offscreen trick is needed there.
  const offscreen = process.env.CLAWNET_E2E_OFFSCREEN === '1' && process.platform === 'darwin';
  // CLAWNET_E2E_NO_FOCUS=1: window appears at its saved position but uses
  // `showInactive()` so the e2e Electron instance doesn't snatch focus
  // from whatever the developer is doing. Useful when you want to *watch*
  // the test run without losing keyboard focus. Implies !offscreen.
  const noFocus = process.env.CLAWNET_E2E_NO_FOCUS === '1';
  const saved = await loadWindowState(userDataDir);

  const opts: Electron.BrowserWindowConstructorOptions = {
    width: saved.width,
    height: saved.height,
    minWidth: 960,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: overlayBg, symbolColor: overlaySymbol, height: 36 },
    webPreferences: {
      // electron-vite emits preload as CJS (`.cjs`) — see electron.vite.config.ts.
      // Electron's sandboxed preload requires CommonJS.
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  };
  // OS-level window/taskbar icon. Packaged builds resolve this from the
  // executable's embedded icon (electron-builder.win.icon), but in dev
  // mode Electron uses its default icon unless we set this explicitly.
  const iconPath = resolveAppIconPath();
  if (iconPath) {
    opts.icon = nativeImage.createFromPath(iconPath);
  }
  if (saved.x !== undefined) opts.x = saved.x;
  if (saved.y !== undefined) opts.y = saved.y;
  if (offscreen) { opts.x = -32000; opts.y = -32000; opts.skipTaskbar = true; }

  const win = new BrowserWindow(opts);

  win.once('ready-to-show', () => {
    // Always call show*() even in offscreen mode — on Linux+xvfb (CI)
    // Playwright waits on actual paint, and skipping show() makes every
    // `toBeVisible()` assertion time out. Offscreen positioning hides
    // the window from the macOS host user; skipTaskbar:true suppresses
    // Dock bounce.
    //
    // `showInactive()` is identical to show() in terms of renderer paint
    // and DOM visibility, but does NOT pull the OS-level focus to this
    // window. Tests still drive the renderer normally via Playwright's
    // CDP channel — the OS focus state is irrelevant to that path.
    //
    // We use showInactive() whenever EITHER offscreen OR no-focus is
    // requested — both modes target "don't disturb the host user".
    // Only the normal interactive/dev mode (neither flag set) uses
    // show() to grab focus on startup like a regular app.
    if (noFocus || offscreen) win.showInactive();
    else win.show();
  });

  let saveTimer: NodeJS.Timeout | null = null;
  const persist = (): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const b = win.getBounds();
      const state: WindowState = { x: b.x, y: b.y, width: b.width, height: b.height };
      void saveWindowState(userDataDir, state);
    }, SAVE_DEBOUNCE_MS);
  };
  win.on('resize', persist);
  win.on('move', persist);
  win.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer);
    const b = win.getBounds();
    const state: WindowState = { x: b.x, y: b.y, width: b.width, height: b.height };
    void saveWindowState(userDataDir, state);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}
