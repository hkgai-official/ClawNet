// Breadth-first directory walker. Mirrors macOS FileSearchHandler.swift:254-287.
// Skips well-known dependency / build directories AND treats macOS-style
// bundle extensions as opaque (we don't recurse into them, even though on
// Windows they're usually just regular directories — kept for parity).

import { readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

export interface WalkedFile {
  path: string;
  size: number;
}

export interface WalkOptions {
  maxDepth: number;
  maxFilesToScan: number;
}

// macOS FileSearchHandler.swift:243-247
const SKIPPED_DIRECTORIES = new Set<string>([
  'node_modules', '.git', '.svn', 'DerivedData', '__pycache__',
  '.build', '.swiftpm', 'Pods', 'Carthage', '.gradle',
  'build', 'dist', '.next', '.nuxt', '.output', 'vendor',
]);

// macOS FileSearchHandler.swift:249-252 — macOS application bundle extensions.
// Windows mostly doesn't have these, but kept for 1:1 parity in case any
// agent passes a path that happens to live inside a Mac-style bundle.
const BUNDLE_EXTENSIONS = new Set<string>([
  'app', 'framework', 'bundle', 'xcodeproj', 'xcworkspace',
  'playground', 'plugin', 'kext', 'xpc', 'qlgenerator',
]);

export async function walkFiles(rootDir: string, opts: WalkOptions): Promise<WalkedFile[]> {
  const results: WalkedFile[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }];

  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!;
    if (depth > opts.maxDepth) continue;

    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith('.') && name !== '.') {
        continue;
      }

      const ext = extname(name).slice(1).toLowerCase();
      if (BUNDLE_EXTENSIONS.has(ext)) continue;

      const fullPath = join(dir, name);

      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(name)) continue;
        if (depth < opts.maxDepth) {
          queue.push({ dir: fullPath, depth: depth + 1 });
        }
      } else if (entry.isFile()) {
        let size = 0;
        try {
          size = (await stat(fullPath)).size;
        } catch {
          continue;
        }
        results.push({ path: fullPath, size });
        if (results.length >= opts.maxFilesToScan) return results;
      }
    }
  }

  return results;
}
