// src/main/features/agents/commands/file-list.ts
//
// 1:1 port of macOS FileCommandHandler.swift:181-305.
// Recursive mode = DFS pre-order traversal (matches NSDirectoryEnumerator).
// Filters .clawnet/ internal paths and hidden (dotfile) entries.

import { z } from 'zod';
import { readdir, lstat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { Stats } from 'node:fs';
import type { NodeCommandHandler, NodeCommandContext } from '../node-event-handler';

export interface CommandPolicyLike {
  check(req: { path: string; op: string; agentId: string }): { decision: string; reason: string };
}

export interface FileListHandlerDeps {
  policy: CommandPolicyLike;
}

const ParamsSchema = z.object({
  path: z.string().min(1),
  recursive: z.boolean().optional(),
  maxDepth: z.number().int().min(0).optional(),
  maxEntries: z.number().int().min(1).optional(),
  sortBy: z.enum(['name', 'modifiedAt', 'createdAt', 'size']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

interface ListEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  createdAt?: number;
  modifiedAt?: number;
  relativePath?: string;
}

const CLAWNET_DIR = '.clawnet';
const MAX_ENTRIES_CAP = 10000;
const DEFAULT_MAX_DEPTH = 5;
const DEFAULT_MAX_ENTRIES = 1000;

function errorJSON(msg: string): string { return JSON.stringify({ error: msg }); }
function okJSON(d: Record<string, unknown>): string { return JSON.stringify(d); }

function isClawnetInternalPath(p: string): boolean {
  // Check both sep-split and '/' split for portability
  return p.split(sep).includes(CLAWNET_DIR) || p.split('/').includes(CLAWNET_DIR);
}

function buildEntry(name: string, info: Stats, relativePath?: string): ListEntry {
  // exactOptionalPropertyTypes: build the required fields first, then
  // conditionally assign optional ones so they are never `undefined`.
  const entry: ListEntry = {
    name,
    type: info.isDirectory() ? 'directory' : 'file',
    size: info.size,
    createdAt: info.birthtimeMs,
    modifiedAt: info.mtimeMs,
  };
  if (relativePath !== undefined) {
    entry.relativePath = relativePath;
  }
  return entry;
}

function sortEntries(entries: ListEntry[], sortBy: string, sortOrder: string): void {
  const dir = sortOrder === 'desc' ? -1 : 1;
  entries.sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case 'modifiedAt': cmp = (a.modifiedAt ?? 0) - (b.modifiedAt ?? 0); break;
      case 'createdAt':  cmp = (a.createdAt ?? 0) - (b.createdAt ?? 0); break;
      case 'size':       cmp = a.size - b.size; break;
      default:           cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
    }
    return cmp * dir;
  });
}

async function listNonRecursive(root: string, maxEntries: number): Promise<ListEntry[]> {
  // May throw ENOENT — caller catches and returns ENUM_FAILED.
  const names = await readdir(root);
  const entries: ListEntry[] = [];
  for (const name of names) {
    if (entries.length >= maxEntries) break;
    // Skip hidden files and .clawnet directory.
    if (name.startsWith('.')) continue;
    const full = join(root, name);
    let info: Stats;
    try { info = await lstat(full); } catch { continue; }
    entries.push(buildEntry(name, info));
  }
  return entries;
}

async function listRecursive(root: string, maxDepth: number, maxEntries: number): Promise<ListEntry[]> {
  const entries: ListEntry[] = [];

  // depth = current directory's level relative to root (root = 0).
  // We recurse into subdirectories as long as depth < maxDepth.
  async function walk(currentDir: string, depth: number): Promise<void> {
    if (entries.length >= maxEntries) return;

    let names: string[];
    // Sort names here for deterministic DFS pre-order (mirrors NSDirectoryEnumerator sorted output).
    try { names = (await readdir(currentDir)).sort(); } catch { return; }

    for (const name of names) {
      if (entries.length >= maxEntries) return;
      // Skip hidden files/dirs (matches Swift .skipsHiddenFiles option).
      if (name.startsWith('.')) continue;
      const full = join(currentDir, name);
      // Skip .clawnet internal paths — also stops descending into them.
      if (isClawnetInternalPath(full)) continue;
      let info: Stats;
      try { info = await lstat(full); } catch { continue; }
      const rel = relative(root, full);
      entries.push(buildEntry(name, info, rel));
      if (info.isDirectory() && depth < maxDepth) {
        await walk(full, depth + 1);
      }
    }
  }

  await walk(root, 0);
  return entries;
}

export function makeFileListHandler(deps: FileListHandlerDeps): NodeCommandHandler {
  return async (ctx: NodeCommandContext) => {
    if (!ctx.paramsJSON) return errorJSON('missing path');
    let raw: unknown;
    try { raw = JSON.parse(ctx.paramsJSON); } catch { return errorJSON('invalid params'); }
    const parsed = ParamsSchema.safeParse(raw);
    if (!parsed.success) {
      if (parsed.error.issues.some((i) => i.path[0] === 'path')) return errorJSON('missing path');
      return errorJSON('invalid params');
    }
    const { path, recursive = false } = parsed.data;
    const maxDepth = parsed.data.maxDepth ?? DEFAULT_MAX_DEPTH;
    const maxEntries = Math.min(parsed.data.maxEntries ?? DEFAULT_MAX_ENTRIES, MAX_ENTRIES_CAP);
    const sortBy = parsed.data.sortBy ?? 'name';
    const sortOrder = parsed.data.sortOrder ?? 'asc';

    const accessCheck = deps.policy.check({ path, op: 'read', agentId: ctx.invokeId });
    if (accessCheck.decision === 'deny') return errorJSON(accessCheck.reason);

    let entries: ListEntry[];
    try {
      entries = recursive
        ? await listRecursive(path, maxDepth, maxEntries)
        : await listNonRecursive(path, maxEntries);
    } catch {
      return errorJSON(`ENUM_FAILED: cannot enumerate '${path}'`);
    }

    sortEntries(entries, sortBy, sortOrder);

    return okJSON({ path, entries, count: entries.length });
  };
}
