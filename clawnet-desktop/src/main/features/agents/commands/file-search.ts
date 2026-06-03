// src/main/features/agents/commands/file-search.ts
//
// 1:1 port of macOS FileSearchHandler.swift:23-126. The tag-ACL gate
// previously inlined here now runs at the NodeEventHandler dispatch layer
// (see Task 4); this handler only enforces the global policy.check.

import { z } from 'zod';
import { stat } from 'node:fs/promises';
import { dirname, basename, extname } from 'node:path';
import type { NodeCommandHandler, NodeCommandContext } from '../node-event-handler';
import { walkFiles } from '../../../utils/fs-walker';
import { extractText } from '../../../utils/text-extractor';
import { matchKeywords } from '../../../utils/keyword-matcher';

// macOS FileSearchHandler.swift:13-19
const DEFAULT_SEARCH_DEPTH = 2;
const MAX_SEARCH_DEPTH = 5;
const DEFAULT_MAX_RESULTS = 50;
const ABSOLUTE_MAX_RESULTS = 200;
const MAX_FILES_TO_SCAN = 5000;
const MAX_FILE_SIZE = 500 * 1024 * 1024;
const PARSE_MAX_TEXT_LENGTH = 500_000;

const ParamsSchema = z.object({
  path: z.string().min(1),
  keywords: z.array(z.string()).min(1),
  depth: z.number().int().min(0).optional(),
  maxResults: z.number().int().min(1).optional(),
});

export interface CommandPolicyLike {
  check(req: { path: string; op: string; agentId: string }): { decision: string; reason: string };
}

export interface BlobUploaderLike {
  upload(data: Buffer): Promise<{ blobId: string } | null>;
}

export interface FileSearchHandlerDeps {
  policy: CommandPolicyLike;
  /** Optional. When present, matched-file text is uploaded to the blob
   *  endpoint and the resulting blobId is attached to each result entry.
   *  Lets agents read full body via the blob URL without an extra file.read
   *  round-trip. Failures are silent — text stays inline as fallback. */
  blobClient?: BlobUploaderLike;
}

interface ResultEntry {
  path: string;
  name: string;
  size: number;
  format: string;
  keywordHits: string[];
  parsed?: boolean;
  text?: string;
  truncated?: boolean;
  blobId?: string;
}

function errorJSON(msg: string): string {
  return JSON.stringify({ error: msg });
}

function okJSON(d: Record<string, unknown>): string {
  return JSON.stringify(d);
}

export function makeFileSearchHandler(deps: FileSearchHandlerDeps): NodeCommandHandler {
  return async (ctx: NodeCommandContext) => {
    if (!ctx.paramsJSON) return errorJSON('missing path');
    let raw: unknown;
    try {
      raw = JSON.parse(ctx.paramsJSON);
    } catch {
      return errorJSON('invalid params');
    }
    const parsed = ParamsSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues;
      if (issues.some((i) => i.path[0] === 'path')) return errorJSON('missing path');
      if (issues.some((i) => i.path[0] === 'keywords')) return errorJSON('missing keywords');
      return errorJSON('invalid params');
    }
    const { path: rawPath, keywords, depth: rawDepth, maxResults: rawMaxResults } = parsed.data;

    const policyResult = deps.policy.check({ path: rawPath, op: 'read', agentId: ctx.invokeId });
    if (policyResult.decision === 'deny') return errorJSON(policyResult.reason);

    // Resolve path: file → parent dir; dir → itself.
    let baseDir = rawPath;
    let baseExists = false;
    try {
      const info = await stat(rawPath);
      baseExists = true;
      if (info.isFile()) baseDir = dirname(rawPath);
    } catch {
      baseDir = dirname(rawPath);
      try {
        await stat(baseDir);
        baseExists = true;
      } catch {
        baseExists = false;
      }
    }
    if (!baseExists) return errorJSON(`NOT_FOUND: ${baseDir}`);

    const depth = Math.min(rawDepth ?? DEFAULT_SEARCH_DEPTH, MAX_SEARCH_DEPTH);
    const maxResults = Math.min(rawMaxResults ?? DEFAULT_MAX_RESULTS, ABSOLUTE_MAX_RESULTS);
    const keywordsLower = keywords.map((k) => k.toLowerCase());

    const files = await walkFiles(baseDir, { maxDepth: depth, maxFilesToScan: MAX_FILES_TO_SCAN });
    const entries: ResultEntry[] = [];
    for (const f of files) {
      if (entries.length >= maxResults) break;
      if (f.size >= MAX_FILE_SIZE) continue;

      const name = basename(f.path);
      const ext = extname(name).slice(1).toLowerCase();
      const match = await matchKeywords(f.path, name, ext, f.size, keywordsLower, { extractText });
      if (match.hits.length === 0) continue;

      const entry: ResultEntry = {
        path: f.path,
        name,
        size: f.size,
        format: match.format,
        keywordHits: match.hits,
      };

      // Resolve text for the result entry. Matcher may short-circuit on
      // filename hits without extracting; re-extract so the LLM still sees
      // the file body when format is parseable.
      let text = match.text;
      if (text === null && match.format !== 'image') {
        try {
          const extracted = await extractText(f.path, ext, f.size);
          text = extracted.text;
        } catch {
          text = null;
        }
      }
      if (text !== null) {
        const clamped = text.slice(0, PARSE_MAX_TEXT_LENGTH);
        entry.parsed = true;
        entry.text = clamped;
        if (text.length > PARSE_MAX_TEXT_LENGTH) entry.truncated = true;
        if (deps.blobClient) {
          const uploaded = await deps.blobClient
            .upload(Buffer.from(clamped, 'utf-8'))
            .catch(() => null);
          if (uploaded?.blobId) entry.blobId = uploaded.blobId;
        }
      }
      entries.push(entry);
    }

    return okJSON({
      basePath: baseDir,
      results: entries,
      count: entries.length,
      maxResults,
    });
  };
}
