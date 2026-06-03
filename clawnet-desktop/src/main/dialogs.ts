import { dialog, BrowserWindow } from 'electron';

/**
 * Thin wrappers around electron's native dialog APIs. Kept at the root of
 * `src/main` so feature handlers can import without dragging in a feature
 * folder's deps. Tests stub these via dependency injection — see
 * `chat.handlers.ts`.
 */

/** Show a Save dialog for downloading a file. Returns the destination path,
 *  or null if the user cancelled. */
export async function showSaveDialog(opts: { suggestedName: string }): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (!win) return null;
  const result = await dialog.showSaveDialog(win, {
    defaultPath: opts.suggestedName,
    title: 'Save file',
  });
  return result.canceled ? null : (result.filePath ?? null);
}

/** Show an Open dialog for picking a single file to upload. Returns the
 *  chosen path or null when the user cancels. */
export async function showOpenFileDialog(): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, { properties: ['openFile'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0]!;
}

/** Show an Open dialog accepting either a single file OR a single folder.
 *  Used by Settings → File Access for picking allowed/denied paths. */
export async function showOpenPathDialog(): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0]!;
}
