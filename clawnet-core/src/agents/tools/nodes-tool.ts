import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import {
  type CameraFacing,
  cameraTempPath,
  parseCameraClipPayload,
  parseCameraSnapPayload,
  writeCameraClipPayloadToFile,
  writeBase64ToFile,
  writeUrlToFile,
} from "../../cli/nodes-camera.js";
import { parseEnvPairs, parseTimeoutMs } from "../../cli/nodes-run.js";
import {
  parseScreenRecordPayload,
  screenRecordTempPath,
  writeScreenRecordToFile,
} from "../../cli/nodes-screen.js";
import { parseDurationMs } from "../../cli/parse-duration.js";
import type { OpenClawConfig } from "../../config/config.js";
import { imageMimeFromFormat } from "../../media/mime.js";
import { sanitizeFilename } from "../../media/store.js";
import { resolveConfigDir } from "../../utils.js";
import { reportBoundaryViolation } from "../boundary-violation.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { resolveImageSanitizationLimits } from "../image-sanitization.js";
import { getSessionTagContext, validateTagNodeAcl } from "../../gateway/tag-context.js";
import { resolveTagWorkspaceDir, resolveDefaultAgentWorkspaceDir } from "../workspace.js";
import { optionalStringEnum, stringEnum } from "../schema/typebox.js";
import { sanitizeToolResultImages } from "../tool-images.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";
import {
  callGatewayTool,
  fetchGatewayBlob,
  readGatewayCallOptions,
  uploadGatewayBlob,
} from "./gateway.js";
import { listNodes, resolveNodeIdFromList, resolveNodeId } from "./nodes-utils.js";

const NODES_TOOL_ACTIONS = [
  "status",
  "describe",
  "pending",
  "approve",
  "reject",
  "notify",
  "camera_snap",
  "camera_list",
  "camera_clip",
  "screen_record",
  "location_get",
  "file_read",
  "file_write",
  "file_stat",
  "file_list",
  "file_search",
  "file_move",
  "file_rename",
  "file_copy",
  "file_mkdir",
  "file_trash",
  "ops_log",
  "ops_undo",
  "ops_rollback",
  "run",
  "invoke",
] as const;

const NOTIFY_PRIORITIES = ["passive", "active", "timeSensitive"] as const;
const NOTIFY_DELIVERIES = ["system", "overlay", "auto"] as const;
const CAMERA_FACING = ["front", "back", "both"] as const;
const LOCATION_ACCURACY = ["coarse", "balanced", "precise"] as const;

function isPairingRequiredMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("pairing required") || lower.includes("not_paired");
}

function extractPairingRequestId(message: string): string | null {
  const match = message.match(/\(requestId:\s*([^)]+)\)/i);
  if (!match) {
    return null;
  }
  const value = (match[1] ?? "").trim();
  return value.length > 0 ? value : null;
}

// Flattened schema: runtime validates per-action requirements.
const NodesToolSchema = Type.Object({
  action: stringEnum(NODES_TOOL_ACTIONS),
  gatewayUrl: Type.Optional(Type.String()),
  gatewayToken: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number()),
  node: Type.Optional(Type.String()),
  requestId: Type.Optional(Type.String()),
  // notify
  title: Type.Optional(Type.String()),
  body: Type.Optional(Type.String()),
  sound: Type.Optional(Type.String()),
  priority: optionalStringEnum(NOTIFY_PRIORITIES),
  delivery: optionalStringEnum(NOTIFY_DELIVERIES),
  // camera_snap / camera_clip
  facing: optionalStringEnum(CAMERA_FACING, {
    description: "camera_snap: front/back/both; camera_clip: front/back only.",
  }),
  maxWidth: Type.Optional(Type.Number()),
  quality: Type.Optional(Type.Number()),
  delayMs: Type.Optional(Type.Number()),
  deviceId: Type.Optional(Type.String()),
  duration: Type.Optional(Type.String()),
  durationMs: Type.Optional(Type.Number()),
  includeAudio: Type.Optional(Type.Boolean()),
  // screen_record
  fps: Type.Optional(Type.Number()),
  screenIndex: Type.Optional(Type.Number()),
  outPath: Type.Optional(Type.String()),
  // location_get
  maxAgeMs: Type.Optional(Type.Number()),
  locationTimeoutMs: Type.Optional(Type.Number()),
  desiredAccuracy: optionalStringEnum(LOCATION_ACCURACY),
  // run
  command: Type.Optional(Type.Array(Type.String())),
  cwd: Type.Optional(Type.String()),
  env: Type.Optional(Type.Array(Type.String())),
  commandTimeoutMs: Type.Optional(Type.Number()),
  invokeTimeoutMs: Type.Optional(Type.Number()),
  needsScreenRecording: Type.Optional(Type.Boolean()),
  // file operations
  path: Type.Optional(Type.String()),
  paths: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "file_read batch mode: array of file paths to read in parallel. Use this instead of path when reading multiple files. Max 20 paths per call.",
    }),
  ),
  sourcePath: Type.Optional(
    Type.String({
      description:
        "file_write: path to a local file on the agent machine to transfer to the node (up to 100 MB).",
    }),
  ),

  fileOffset: Type.Optional(Type.Number()),
  fileLimit: Type.Optional(Type.Number()),
  saveTo: Type.Optional(
    Type.String({
      description:
        "Local path to save the downloaded file to. When specified, the file is saved directly to this path. Otherwise, files are saved to ~/.openclaw/files/YYYY-MM-DD/ with the original filename preserved.",
    }),
  ),
  // file_search
  keywords: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "file_search: keywords to match against filenames and file content (case-insensitive).",
    }),
  ),
  searchDepth: Type.Optional(
    Type.Number({
      description: "file_search: max directory traversal depth from path (default 2, max 5).",
    }),
  ),
  searchHeadBytes: Type.Optional(
    Type.Number({
      description: "file_search: bytes for head preview of text content (default 256).",
    }),
  ),
  searchTailBytes: Type.Optional(
    Type.Number({
      description: "file_search: bytes for tail preview of text content (default 256).",
    }),
  ),
  searchMaxResults: Type.Optional(
    Type.Number({
      description: "file_search: max number of matching files to return (default 50, max 200).",
    }),
  ),
  createDirs: Type.Optional(Type.Boolean()),
  append: Type.Optional(Type.Boolean()),
  // file_move / file_copy
  source: Type.Optional(
    Type.String({
      description:
        "file_move/file_copy: source file or directory path on the node.",
    }),
  ),
  destination: Type.Optional(
    Type.String({
      description:
        "file_move/file_copy: destination path on the node.",
    }),
  ),
  overwrite: Type.Optional(
    Type.Boolean({
      description:
        "file_move/file_rename/file_copy: overwrite if destination already exists (default false).",
    }),
  ),
  // file_rename
  newName: Type.Optional(
    Type.String({
      description:
        "file_rename: new filename (name only, no path separator).",
    }),
  ),
  // file_mkdir
  recursive: Type.Optional(
    Type.Boolean({
      description: "file_mkdir: create intermediate directories (default true). file_list: recursive listing (default false).",
    }),
  ),
  // file_list enhanced
  maxDepth: Type.Optional(
    Type.Number({
      description: "file_list: max recursion depth (default 5, only with recursive=true).",
    }),
  ),
  maxEntries: Type.Optional(
    Type.Number({
      description: "file_list: max entries to return (default 1000).",
    }),
  ),
  sortBy: optionalStringEnum(["name", "modifiedAt", "createdAt", "size"] as const, {
    description: "file_list: sort field (default 'name').",
  }),
  sortOrder: optionalStringEnum(["asc", "desc"] as const, {
    description: "file_list: sort order (default 'asc').",
  }),
  // ops_log
  sessionId: Type.Optional(
    Type.String({
      description: "ops_log/ops_rollback: filter by session ID.",
    }),
  ),
  since: Type.Optional(
    Type.Number({
      description: "ops_log/ops_rollback: start timestamp in milliseconds.",
    }),
  ),
  until: Type.Optional(
    Type.Number({
      description: "ops_log: end timestamp in milliseconds.",
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      description: "ops_log: max entries to return (default 50).",
    }),
  ),
  offset: Type.Optional(
    Type.Number({
      description: "ops_log: pagination offset (default 0).",
    }),
  ),
  // ops_undo
  operationId: Type.Optional(
    Type.String({
      description: "ops_undo: the operation ID to undo.",
    }),
  ),
  // ops_rollback
  dryRun: Type.Optional(
    Type.Boolean({
      description: "ops_rollback: preview only without executing (default true).",
    }),
  ),
  // invoke
  invokeCommand: Type.Optional(Type.String()),
  invokeParamsJson: Type.Optional(Type.String()),
});

export function createNodesTool(options?: {
  agentSessionKey?: string;
  config?: OpenClawConfig;
}): AnyAgentTool {
  const sessionKey = options?.agentSessionKey?.trim() || undefined;
  const agentId = resolveSessionAgentId({
    sessionKey: options?.agentSessionKey,
    config: options?.config,
  });
  const imageSanitization = resolveImageSanitizationLimits(options?.config);

  /**
   * Defense-in-depth: check tag ACL for file paths before forwarding to node.
   * If the tag has allowedPaths configured, only those paths (subset of global whitelist) are allowed.
   * If allowedPaths is empty, no per-tag restriction is applied (full whitelist access).
   */
  const checkTagAcl = (
    filePaths: string[],
    operation: "read" | "write" = "read",
  ): string | null => {
    if (!sessionKey) return null;
    const tagCtx = getSessionTagContext(sessionKey);
    if (!tagCtx?.nodeAcl) return null;
    // Empty allowedPaths + empty deniedPaths = no per-tag restriction
    if (tagCtx.nodeAcl.allowedPaths.length === 0 && tagCtx.nodeAcl.deniedPaths.length === 0) {
      return null;
    }
    for (const p of filePaths) {
      const check = validateTagNodeAcl(tagCtx.nodeAcl, p, operation, tagCtx.accessMode);
      if (!check.allowed) {
        const accessMode = tagCtx.accessMode ?? "rw";
        reportBoundaryViolation({
          type: "node_acl_denied",
          sessionKey,
          tagName: tagCtx.tagName,
          tagWorkspaceId: tagCtx.workspaceId,
          boundary: tagCtx.nodeAcl.allowedPaths.join(", ") || "(none)",
          attemptedPath: p,
          detail: `Tag ACL denied: ${check.reason} (op=${operation}, mode=${accessMode})`,
        });
        return `Tag ACL denied: ${check.reason} (path: ${p}, mode: ${accessMode})`;
      }
    }
    return null;
  };

  const checkWorkspaceIsolation = (filePaths: string[]): string | null => {
    if (!sessionKey) return null;
    const tagCtx = getSessionTagContext(sessionKey);
    if (!tagCtx?.workspaceId) return null;

    // Main agent can access the entire workspace directory (all tag workspaces)
    if (tagCtx.isMain) return null;

    const workspaceRoot = resolveDefaultAgentWorkspaceDir();
    const allowedDir = resolveTagWorkspaceDir(tagCtx.workspaceId);

    for (const p of filePaths) {
      const resolved = path.resolve(p);
      // Only enforce for paths within the workspace mount
      if (!resolved.startsWith(workspaceRoot + path.sep) && resolved !== workspaceRoot) {
        continue; // not a workspace path, node ACL handles remote files
      }
      // Must be within the current tag's subdirectory
      if (!resolved.startsWith(allowedDir + path.sep) && resolved !== allowedDir) {
        reportBoundaryViolation({
          type: "node_workspace_isolation",
          sessionKey,
          tagName: tagCtx.tagName,
          tagWorkspaceId: tagCtx.workspaceId,
          boundary: allowedDir,
          attemptedPath: p,
          detail: `Workspace isolation: access denied to ${p} (current tag: ${tagCtx.workspaceId})`,
        });
        return `Workspace isolation: access denied to ${p} (current tag: ${tagCtx.workspaceId})`;
      }
    }
    return null;
  };

  return {
    label: "Nodes",
    name: "nodes",
    description: `Interact with paired nodes (phones, desktops, etc).

DISCOVERY & PAIRING:
- status: List all connected nodes with their capabilities and commands.
- describe: Get detailed info about a specific node (node param required).
- pending/approve/reject: Manage pairing requests.

FILE OPERATIONS (all file data transferred via Gateway blob store — node uploads/downloads blobs directly):
- file_search: Search files by keywords across directory trees. Returns metadata + text previews.
  Params: path (search root directory — searched directly, not its parent), keywords (string[]), searchDepth (default 2, max 5), searchMaxResults (default 50, max 200).
- file_read: Read a file from the node and save it locally on the agent machine.
  Returns { nodePath, savedTo, size, bytesRead } where savedTo is the local path on the agent machine.
  Default save location: ~/.openclaw/files/YYYY-MM-DD/<filename>. Use saveTo param to override.
  Supports single file (path param) or batch (paths param, up to 20 files in parallel).
  For documents (PDF, docx, Excel, PowerPoint), download first, then convert locally with: uvx markitdown[all] <savedTo>
- file_write: Write a local file to the node (up to 100 MB). sourcePath param is required (path to the file on the agent machine).
- file_stat: Get file metadata (size, dates, permissions).
- file_list: List directory contents. Supports recursive listing with depth control, sorting, and time fields.
  Params: path, recursive (default false), maxDepth (default 5), maxEntries (default 1000), sortBy (name/modifiedAt/createdAt/size), sortOrder (asc/desc).
- file_move: Move a file or directory from source to destination. Params: source, destination, overwrite (default false).
  Destination parent directory must exist (use file_mkdir first if needed).
  Returns { oldPath, newPath, operationId }. Can be undone with ops_undo using the returned operationId.
- file_rename: Rename a file or directory in place. Params: path, newName (filename only, no '/'), overwrite (default false).
  Returns { oldPath, newPath, operationId }. Can be undone with ops_undo using the returned operationId.
- file_copy: Copy a file or directory from source to destination. Params: source, destination, overwrite (default false).
  Directories are copied recursively.
  Returns { source, destination, operationId }. Can be undone with ops_undo using the returned operationId.
- file_mkdir: Create a directory. Params: path, recursive (default true, creates intermediate dirs).
  Idempotent — succeeds if directory already exists.
  Returns { path, created, operationId }. Can be undone with ops_undo using the returned operationId.
- file_trash: Move a file or directory to the workspace recycle bin (.clawnet/trash/). Params: path.
  Returns { path, trashId, operationId }. Can be undone with ops_undo using the returned operationId.

OPERATION HISTORY & UNDO:
- ops_log: Query operation history. Params: path (workspace indicator), sessionId, command, since, until, limit (default 50), offset.
- ops_undo: Undo a single operation. Params: path (workspace indicator), operationId. Validates preconditions before executing.
- ops_rollback: Batch undo operations. Params: path (workspace indicator), sessionId or since (one required), dryRun (default true).
  Use dryRun=true first to preview, then dryRun=false to execute.

SYSTEM:
- run: Execute a shell command on the node (may require user approval). command param is argv array, e.g. ["ls", "-la"].
- notify: Send a system notification (title/body required).
- invoke: Low-level escape hatch — invoke any node command directly (invokeCommand + invokeParamsJson).`,
    parameters: NodesToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const gatewayOpts = readGatewayCallOptions(params);

      try {
        switch (action) {
          case "status": {
            const listResult = await callGatewayTool("node.list", gatewayOpts, {});
            // Enrich each node with currentTagAccess based on agent's active tag context
            if (sessionKey && listResult?.nodes) {
              const tagCtx = getSessionTagContext(sessionKey);
              if (tagCtx) {
                for (const node of listResult.nodes as Record<string, unknown>[]) {
                  const tfa = node.tagFileAccess as
                    | Record<string, { allowedPaths: string[]; deniedPaths: string[] }>
                    | undefined;
                  const tagAccess = tfa?.[tagCtx.tagName];
                  (node as Record<string, unknown>).currentTagAccess = {
                    tagName: tagCtx.tagName,
                    tagDisplayName: tagCtx.tagDisplayName,
                    accessMode: tagCtx.accessMode ?? "rw",
                    allowedPaths: tagAccess?.allowedPaths ?? [],
                    deniedPaths: tagAccess?.deniedPaths ?? [],
                  };
                }
              }
            }
            return jsonResult(listResult);
          }
          case "describe": {
            const node = readStringParam(params, "node", { required: true });
            const nodeId = await resolveNodeId(gatewayOpts, node);
            return jsonResult(await callGatewayTool("node.describe", gatewayOpts, { nodeId }));
          }
          case "pending":
            return jsonResult(await callGatewayTool("node.pair.list", gatewayOpts, {}));
          case "approve": {
            const requestId = readStringParam(params, "requestId", {
              required: true,
            });
            return jsonResult(
              await callGatewayTool("node.pair.approve", gatewayOpts, {
                requestId,
              }),
            );
          }
          case "reject": {
            const requestId = readStringParam(params, "requestId", {
              required: true,
            });
            return jsonResult(
              await callGatewayTool("node.pair.reject", gatewayOpts, {
                requestId,
              }),
            );
          }
          case "notify": {
            const node = readStringParam(params, "node", { required: true });
            const title = typeof params.title === "string" ? params.title : "";
            const body = typeof params.body === "string" ? params.body : "";
            if (!title.trim() && !body.trim()) {
              throw new Error("title or body required");
            }
            const nodeId = await resolveNodeId(gatewayOpts, node);
            await callGatewayTool("node.invoke", gatewayOpts, {
              nodeId,
              command: "system.notify",
              params: {
                title: title.trim() || undefined,
                body: body.trim() || undefined,
                sound: typeof params.sound === "string" ? params.sound : undefined,
                priority: typeof params.priority === "string" ? params.priority : undefined,
                delivery: typeof params.delivery === "string" ? params.delivery : undefined,
              },
              idempotencyKey: crypto.randomUUID(),
            });
            return jsonResult({ ok: true });
          }
          case "camera_snap": {
            const node = readStringParam(params, "node", { required: true });
            const nodeId = await resolveNodeId(gatewayOpts, node);
            const facingRaw =
              typeof params.facing === "string" ? params.facing.toLowerCase() : "both";
            const facings: CameraFacing[] =
              facingRaw === "both"
                ? ["front", "back"]
                : facingRaw === "front" || facingRaw === "back"
                  ? [facingRaw]
                  : (() => {
                      throw new Error("invalid facing (front|back|both)");
                    })();
            const maxWidth =
              typeof params.maxWidth === "number" && Number.isFinite(params.maxWidth)
                ? params.maxWidth
                : undefined;
            const quality =
              typeof params.quality === "number" && Number.isFinite(params.quality)
                ? params.quality
                : undefined;
            const delayMs =
              typeof params.delayMs === "number" && Number.isFinite(params.delayMs)
                ? params.delayMs
                : undefined;
            const deviceId =
              typeof params.deviceId === "string" && params.deviceId.trim()
                ? params.deviceId.trim()
                : undefined;

            const content: AgentToolResult<unknown>["content"] = [];
            const details: Array<Record<string, unknown>> = [];

            for (const facing of facings) {
              const raw = await callGatewayTool<{ payload: unknown }>("node.invoke", gatewayOpts, {
                nodeId,
                command: "camera.snap",
                params: {
                  facing,
                  maxWidth,
                  quality,
                  format: "jpg",
                  delayMs,
                  deviceId,
                },
                idempotencyKey: crypto.randomUUID(),
              });
              const payload = parseCameraSnapPayload(raw?.payload);
              const normalizedFormat = payload.format.toLowerCase();
              if (
                normalizedFormat !== "jpg" &&
                normalizedFormat !== "jpeg" &&
                normalizedFormat !== "png"
              ) {
                throw new Error(`unsupported camera.snap format: ${payload.format}`);
              }

              const isJpeg = normalizedFormat === "jpg" || normalizedFormat === "jpeg";
              const filePath = cameraTempPath({
                kind: "snap",
                facing,
                ext: isJpeg ? "jpg" : "png",
              });
              if (payload.url) {
                await writeUrlToFile(filePath, payload.url);
              } else if (payload.base64) {
                await writeBase64ToFile(filePath, payload.base64);
              }
              content.push({ type: "text", text: `MEDIA:${filePath}` });
              if (payload.base64) {
                content.push({
                  type: "image",
                  data: payload.base64,
                  mimeType:
                    imageMimeFromFormat(payload.format) ?? (isJpeg ? "image/jpeg" : "image/png"),
                });
              }
              details.push({
                facing,
                path: filePath,
                width: payload.width,
                height: payload.height,
              });
            }

            const result: AgentToolResult<unknown> = { content, details };
            return await sanitizeToolResultImages(result, "nodes:camera_snap", imageSanitization);
          }
          case "camera_list": {
            const node = readStringParam(params, "node", { required: true });
            const nodeId = await resolveNodeId(gatewayOpts, node);
            const raw = await callGatewayTool<{ payload: unknown }>("node.invoke", gatewayOpts, {
              nodeId,
              command: "camera.list",
              params: {},
              idempotencyKey: crypto.randomUUID(),
            });
            const payload =
              raw && typeof raw.payload === "object" && raw.payload !== null ? raw.payload : {};
            return jsonResult(payload);
          }
          case "camera_clip": {
            const node = readStringParam(params, "node", { required: true });
            const nodeId = await resolveNodeId(gatewayOpts, node);
            const facing =
              typeof params.facing === "string" ? params.facing.toLowerCase() : "front";
            if (facing !== "front" && facing !== "back") {
              throw new Error("invalid facing (front|back)");
            }
            const durationMs =
              typeof params.durationMs === "number" && Number.isFinite(params.durationMs)
                ? params.durationMs
                : typeof params.duration === "string"
                  ? parseDurationMs(params.duration)
                  : 3000;
            const includeAudio =
              typeof params.includeAudio === "boolean" ? params.includeAudio : true;
            const deviceId =
              typeof params.deviceId === "string" && params.deviceId.trim()
                ? params.deviceId.trim()
                : undefined;
            const raw = await callGatewayTool<{ payload: unknown }>("node.invoke", gatewayOpts, {
              nodeId,
              command: "camera.clip",
              params: {
                facing,
                durationMs,
                includeAudio,
                format: "mp4",
                deviceId,
              },
              idempotencyKey: crypto.randomUUID(),
            });
            const payload = parseCameraClipPayload(raw?.payload);
            const filePath = await writeCameraClipPayloadToFile({
              payload,
              facing,
            });
            return {
              content: [{ type: "text", text: `FILE:${filePath}` }],
              details: {
                facing,
                path: filePath,
                durationMs: payload.durationMs,
                hasAudio: payload.hasAudio,
              },
            };
          }
          case "screen_record": {
            const node = readStringParam(params, "node", { required: true });
            const nodeId = await resolveNodeId(gatewayOpts, node);
            const durationMs =
              typeof params.durationMs === "number" && Number.isFinite(params.durationMs)
                ? params.durationMs
                : typeof params.duration === "string"
                  ? parseDurationMs(params.duration)
                  : 10_000;
            const fps =
              typeof params.fps === "number" && Number.isFinite(params.fps) ? params.fps : 10;
            const screenIndex =
              typeof params.screenIndex === "number" && Number.isFinite(params.screenIndex)
                ? params.screenIndex
                : 0;
            const includeAudio =
              typeof params.includeAudio === "boolean" ? params.includeAudio : true;
            const raw = await callGatewayTool<{ payload: unknown }>("node.invoke", gatewayOpts, {
              nodeId,
              command: "screen.record",
              params: {
                durationMs,
                screenIndex,
                fps,
                format: "mp4",
                includeAudio,
              },
              idempotencyKey: crypto.randomUUID(),
            });
            const payload = parseScreenRecordPayload(raw?.payload);
            const filePath =
              typeof params.outPath === "string" && params.outPath.trim()
                ? params.outPath.trim()
                : screenRecordTempPath({ ext: payload.format || "mp4" });
            const written = await writeScreenRecordToFile(filePath, payload.base64);
            return {
              content: [{ type: "text", text: `FILE:${written.path}` }],
              details: {
                path: written.path,
                durationMs: payload.durationMs,
                fps: payload.fps,
                screenIndex: payload.screenIndex,
                hasAudio: payload.hasAudio,
              },
            };
          }
          case "location_get": {
            const node = readStringParam(params, "node", { required: true });
            const nodeId = await resolveNodeId(gatewayOpts, node);
            const maxAgeMs =
              typeof params.maxAgeMs === "number" && Number.isFinite(params.maxAgeMs)
                ? params.maxAgeMs
                : undefined;
            const desiredAccuracy =
              params.desiredAccuracy === "coarse" ||
              params.desiredAccuracy === "balanced" ||
              params.desiredAccuracy === "precise"
                ? params.desiredAccuracy
                : undefined;
            const locationTimeoutMs =
              typeof params.locationTimeoutMs === "number" &&
              Number.isFinite(params.locationTimeoutMs)
                ? params.locationTimeoutMs
                : undefined;
            const raw = await callGatewayTool<{ payload: unknown }>("node.invoke", gatewayOpts, {
              nodeId,
              command: "location.get",
              params: {
                maxAgeMs,
                desiredAccuracy,
                timeoutMs: locationTimeoutMs,
              },
              idempotencyKey: crypto.randomUUID(),
            });
            return jsonResult(raw?.payload ?? {});
          }
          case "run": {
            const node = readStringParam(params, "node", { required: true });
            const nodes = await listNodes(gatewayOpts);
            if (nodes.length === 0) {
              throw new Error(
                "system.run requires a paired companion app or node host (no nodes available).",
              );
            }
            const nodeId = resolveNodeIdFromList(nodes, node);
            const nodeInfo = nodes.find((entry) => entry.nodeId === nodeId);
            const supportsSystemRun = Array.isArray(nodeInfo?.commands)
              ? nodeInfo?.commands?.includes("system.run")
              : false;
            if (!supportsSystemRun) {
              throw new Error(
                "system.run requires a companion app or node host; the selected node does not support system.run.",
              );
            }
            const commandRaw = params.command;
            if (!commandRaw) {
              throw new Error("command required (argv array, e.g. ['echo', 'Hello'])");
            }
            if (!Array.isArray(commandRaw)) {
              throw new Error("command must be an array of strings (argv), e.g. ['echo', 'Hello']");
            }
            const command = commandRaw.map((c) => String(c));
            if (command.length === 0) {
              throw new Error("command must not be empty");
            }
            const cwd =
              typeof params.cwd === "string" && params.cwd.trim() ? params.cwd.trim() : undefined;
            // Tag workspace isolation: check workdir if provided
            if (cwd) {
              const aclDeniedRun = checkTagAcl([cwd]);
              if (aclDeniedRun) return jsonResult({ status: "error", error: aclDeniedRun });
              const wsDeniedRun = checkWorkspaceIsolation([cwd]);
              if (wsDeniedRun) return jsonResult({ status: "error", error: wsDeniedRun });
            }
            const env = parseEnvPairs(params.env);
            const commandTimeoutMs = parseTimeoutMs(params.commandTimeoutMs);
            const invokeTimeoutMs = parseTimeoutMs(params.invokeTimeoutMs);
            const needsScreenRecording =
              typeof params.needsScreenRecording === "boolean"
                ? params.needsScreenRecording
                : undefined;
            const runParams = {
              command,
              cwd,
              env,
              timeoutMs: commandTimeoutMs,
              needsScreenRecording,
              agentId,
              sessionKey,
            };

            // First attempt without approval flags.
            try {
              const raw = await callGatewayTool<{ payload?: unknown }>("node.invoke", gatewayOpts, {
                nodeId,
                command: "system.run",
                params: runParams,
                timeoutMs: invokeTimeoutMs,
                idempotencyKey: crypto.randomUUID(),
              });
              return jsonResult(raw?.payload ?? {});
            } catch (firstErr) {
              const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
              if (!msg.includes("SYSTEM_RUN_DENIED: approval required")) {
                throw firstErr;
              }
            }

            // Node requires approval – create a pending approval request on
            // the gateway and wait for the user to approve/deny via the UI.
            const APPROVAL_TIMEOUT_MS = 120_000;
            const cmdText = command.join(" ");
            const approvalId = crypto.randomUUID();
            const approvalResult = await callGatewayTool(
              "exec.approval.request",
              { ...gatewayOpts, timeoutMs: APPROVAL_TIMEOUT_MS + 5_000 },
              {
                id: approvalId,
                command: cmdText,
                cwd,
                nodeId,
                host: "node",
                agentId,
                sessionKey,
                timeoutMs: APPROVAL_TIMEOUT_MS,
              },
            );
            const decisionRaw =
              approvalResult && typeof approvalResult === "object"
                ? (approvalResult as { decision?: unknown }).decision
                : undefined;
            const approvalDecision =
              decisionRaw === "allow-once" || decisionRaw === "allow-always" ? decisionRaw : null;

            if (!approvalDecision) {
              if (decisionRaw === "deny") {
                throw new Error("exec denied: user denied");
              }
              if (decisionRaw === undefined || decisionRaw === null) {
                throw new Error("exec denied: approval timed out");
              }
              throw new Error("exec denied: invalid approval decision");
            }

            // Retry with the approval decision.
            const raw = await callGatewayTool<{ payload?: unknown }>("node.invoke", gatewayOpts, {
              nodeId,
              command: "system.run",
              params: {
                ...runParams,
                runId: approvalId,
                approved: true,
                approvalDecision,
              },
              timeoutMs: invokeTimeoutMs,
              idempotencyKey: crypto.randomUUID(),
            });
            return jsonResult(raw?.payload ?? {});
          }
          case "file_read": {
            const node = readStringParam(params, "node", { required: true });
            const nodeId = await resolveNodeId(gatewayOpts, node);
            const fileOffset =
              typeof params.fileOffset === "number" ? params.fileOffset : undefined;
            const fileLimit = typeof params.fileLimit === "number" ? params.fileLimit : undefined;
            const saveTo = readStringParam(params, "saveTo");
            const timeoutMs = parseTimeoutMs(params.invokeTimeoutMs) ?? 30_000;

            // Resolve file paths: single `path` or batch `paths`
            const singlePath = readStringParam(params, "path");
            const batchPaths = Array.isArray(params.paths) ? (params.paths as string[]) : undefined;
            if (!singlePath && !batchPaths) {
              throw new Error("path or paths required");
            }

            const filePaths =
              batchPaths && batchPaths.length > 0 ? batchPaths.slice(0, 20) : [singlePath!];

            const aclDenied = checkTagAcl(filePaths);
            if (aclDenied) return jsonResult({ status: "error", error: aclDenied });

            const wsDenied = checkWorkspaceIsolation(filePaths);
            if (wsDenied) return jsonResult({ status: "error", error: wsDenied });

            const readOneFile = async (filePath: string): Promise<Record<string, unknown>> => {
              const result = await callGatewayTool("node.invoke", gatewayOpts, {
                nodeId,
                command: "file.read",
                params: {
                  path: filePath,
                  offset: fileOffset,
                  limit: fileLimit,
                },
                timeoutMs,
                idempotencyKey: crypto.randomUUID(),
              });
              const payload = (result?.payload ?? {}) as Record<string, unknown>;

              if (payload.transfer === "blob" && typeof payload.blobId === "string") {
                const totalSize = typeof payload.size === "number" ? payload.size : 0;
                const blobData = await fetchGatewayBlob(payload.blobId, gatewayOpts);

                let destPath: string;
                if (saveTo) {
                  destPath = path.resolve(saveTo);
                } else {
                  const today = new Date().toISOString().slice(0, 10);
                  const tagCtxForFiles = sessionKey ? getSessionTagContext(sessionKey) : undefined;
                  const filesDir = tagCtxForFiles?.workspaceId
                    ? path.join(resolveTagWorkspaceDir(tagCtxForFiles.workspaceId), "files", today)
                    : path.join(resolveConfigDir(), "files", today);
                  const ext = path.extname(filePath) || ".bin";
                  const baseName = sanitizeFilename(path.basename(filePath, ext));
                  const destName = baseName
                    ? `${baseName}---${crypto.randomUUID()}${ext}`
                    : `${crypto.randomUUID()}${ext}`;
                  destPath = path.join(filesDir, destName);
                }
                await fs.mkdir(path.dirname(destPath), { recursive: true });
                await fs.writeFile(destPath, blobData);

                return {
                  nodePath: filePath,
                  savedTo: destPath,
                  size: totalSize,
                  bytesRead: blobData.length,
                };
              }

              if (typeof payload.error === "string") {
                return { path: filePath, error: payload.error };
              }
              return {
                path: filePath,
                error: "unexpected response: missing blob transfer",
                raw: payload,
              };
            };

            // Single file: return flat result for backward compatibility
            if (filePaths.length === 1) {
              const result = await readOneFile(filePaths[0]!);
              return jsonResult(result);
            }

            // Batch: read all files in parallel, collect results
            const settled = await Promise.allSettled(filePaths.map(readOneFile));
            const results = settled.map((s, i) =>
              s.status === "fulfilled"
                ? s.value
                : { path: filePaths[i], error: (s.reason as Error).message ?? String(s.reason) },
            );
            return jsonResult({ results, count: results.length });
          }
          case "file_write": {
            const node = readStringParam(params, "node", { required: true });
            const nodeId = await resolveNodeId(gatewayOpts, node);
            const filePath = readStringParam(params, "path", { required: true });
            const sourcePath = readStringParam(params, "sourcePath", { required: true });
            const timeoutMs = parseTimeoutMs(params.invokeTimeoutMs) ?? 60_000;

            const aclDeniedW = checkTagAcl([filePath], "write");
            if (aclDeniedW) return jsonResult({ status: "error", error: aclDeniedW });

            const wsDeniedW = checkWorkspaceIsolation([filePath]);
            if (wsDeniedW) return jsonResult({ status: "error", error: wsDeniedW });

            const writeData = Buffer.from(await fs.readFile(path.resolve(sourcePath)));

            const blobId = await uploadGatewayBlob(writeData, gatewayOpts);
            const raw = await callGatewayTool("node.invoke", gatewayOpts, {
              nodeId,
              command: "file.write",
              params: {
                path: filePath,
                blobId,
                createDirs: params.createDirs ?? false,
                append: params.append ?? false,
              },
              timeoutMs,
              idempotencyKey: crypto.randomUUID(),
            });
            return jsonResult(raw?.payload ?? {});
          }
          case "file_stat": {
            const node = readStringParam(params, "node", { required: true });
            const nodeId = await resolveNodeId(gatewayOpts, node);
            const filePath = readStringParam(params, "path", { required: true });
            const aclDeniedS = checkTagAcl([filePath]);
            if (aclDeniedS) return jsonResult({ status: "error", error: aclDeniedS });

            const wsDeniedS = checkWorkspaceIsolation([filePath]);
            if (wsDeniedS) return jsonResult({ status: "error", error: wsDeniedS });
            const raw = await callGatewayTool("node.invoke", gatewayOpts, {
              nodeId,
              command: "file.stat",
              params: { path: filePath },
              timeoutMs: parseTimeoutMs(params.invokeTimeoutMs) ?? 30_000,
              idempotencyKey: crypto.randomUUID(),
            });
            return jsonResult(raw?.payload ?? {});
          }
          case "file_list": {
            const node = readStringParam(params, "node", { required: true });
            const nodeId = await resolveNodeId(gatewayOpts, node);
            const filePath = readStringParam(params, "path", { required: true });
            const aclDeniedL = checkTagAcl([filePath]);
            if (aclDeniedL) return jsonResult({ status: "error", error: aclDeniedL });

            const wsDeniedL = checkWorkspaceIsolation([filePath]);
            if (wsDeniedL) return jsonResult({ status: "error", error: wsDeniedL });
            const listParams: Record<string, unknown> = { path: filePath };
            if (typeof params.recursive === "boolean") listParams.recursive = params.recursive;
            if (typeof params.maxDepth === "number") listParams.maxDepth = params.maxDepth;
            if (typeof params.maxEntries === "number") listParams.maxEntries = params.maxEntries;
            if (typeof params.sortBy === "string") listParams.sortBy = params.sortBy;
            if (typeof params.sortOrder === "string") listParams.sortOrder = params.sortOrder;
            const raw = await callGatewayTool("node.invoke", gatewayOpts, {
              nodeId,
              command: "file.list",
              params: listParams,
              timeoutMs: parseTimeoutMs(params.invokeTimeoutMs) ?? 30_000,
              idempotencyKey: crypto.randomUUID(),
            });
            return jsonResult(raw?.payload ?? {});
          }
          case "file_search": {
            const node = readStringParam(params, "node", { required: true });
            const nodeId = await resolveNodeId(gatewayOpts, node);
            const filePath = readStringParam(params, "path", { required: true });
            const aclDeniedSr = checkTagAcl([filePath]);
            if (aclDeniedSr) return jsonResult({ status: "error", error: aclDeniedSr });

            const wsDeniedSr = checkWorkspaceIsolation([filePath]);
            if (wsDeniedSr) return jsonResult({ status: "error", error: wsDeniedSr });
            const keywords = params.keywords;
            if (!Array.isArray(keywords) || keywords.length === 0) {
              throw new Error("keywords required (array of strings)");
            }
            const searchParams: Record<string, unknown> = {
              path: filePath,
              keywords,
            };
            if (typeof params.searchDepth === "number") searchParams.depth = params.searchDepth;
            if (typeof params.searchHeadBytes === "number")
              searchParams.headBytes = params.searchHeadBytes;
            if (typeof params.searchTailBytes === "number")
              searchParams.tailBytes = params.searchTailBytes;
            if (typeof params.searchMaxResults === "number")
              searchParams.maxResults = params.searchMaxResults;

            // Search may take longer due to directory traversal + parsing
            const timeoutMs = parseTimeoutMs(params.invokeTimeoutMs) ?? 120_000;
            const raw = await callGatewayTool("node.invoke", gatewayOpts, {
              nodeId,
              command: "file.search",
              params: searchParams,
              timeoutMs,
              idempotencyKey: crypto.randomUUID(),
            });
            return jsonResult(raw?.payload ?? {});
          }
          case "file_move": {
            const node = readStringParam(params, "node", { required: true });
            const nodeId = await resolveNodeId(gatewayOpts, node);
            const source = readStringParam(params, "source", { required: true });
            const destination = readStringParam(params, "destination", { required: true });
            const aclDeniedMR = checkTagAcl([source]);
            if (aclDeniedMR) return jsonResult({ status: "error", error: aclDeniedMR });
            const aclDeniedMW = checkTagAcl([destination], "write");
            if (aclDeniedMW) return jsonResult({ status: "error", error: aclDeniedMW });
            const wsDeniedMS = checkWorkspaceIsolation([source]);
            if (wsDeniedMS) return jsonResult({ status: "error", error: wsDeniedMS });
            const wsDeniedMD = checkWorkspaceIsolation([destination]);
            if (wsDeniedMD) return jsonResult({ status: "error", error: wsDeniedMD });

            const moveParams: Record<string, unknown> = { source, destination };
            if (typeof params.overwrite === "boolean") moveParams.overwrite = params.overwrite;
            const raw = await callGatewayTool("node.invoke", gatewayOpts, {
              nodeId,
              command: "file.move",
              params: moveParams,
              timeoutMs: parseTimeoutMs(params.invokeTimeoutMs) ?? 30_000,
              idempotencyKey: crypto.randomUUID(),
            });
            return jsonResult(raw?.payload ?? {});
          }
          case "file_rename": {
            const node = readStringParam(params, "node", { required: true });
            const nodeId = await resolveNodeId(gatewayOpts, node);
            const filePath = readStringParam(params, "path", { required: true });
            const newName = readStringParam(params, "newName", { required: true });
            const aclDeniedRn = checkTagAcl([filePath], "write");
            if (aclDeniedRn) return jsonResult({ status: "error", error: aclDeniedRn });
            const wsDeniedRn = checkWorkspaceIsolation([filePath]);
            if (wsDeniedRn) return jsonResult({ status: "error", error: wsDeniedRn });

            const renameParams: Record<string, unknown> = { path: filePath, newName };
            if (typeof params.overwrite === "boolean") renameParams.overwrite = params.overwrite;
            const raw = await callGatewayTool("node.invoke", gatewayOpts, {
              nodeId,
              command: "file.rename",
              params: renameParams,
              timeoutMs: parseTimeoutMs(params.invokeTimeoutMs) ?? 30_000,
              idempotencyKey: crypto.randomUUID(),
            });
            return jsonResult(raw?.payload ?? {});
          }
          case "file_copy": {
            const node = readStringParam(params, "node", { required: true });
            const nodeId = await resolveNodeId(gatewayOpts, node);
            const source = readStringParam(params, "source", { required: true });
            const destination = readStringParam(params, "destination", { required: true });
            const aclDeniedCR = checkTagAcl([source]);
            if (aclDeniedCR) return jsonResult({ status: "error", error: aclDeniedCR });
            const aclDeniedCW = checkTagAcl([destination], "write");
            if (aclDeniedCW) return jsonResult({ status: "error", error: aclDeniedCW });
            const wsDeniedCS = checkWorkspaceIsolation([source]);
            if (wsDeniedCS) return jsonResult({ status: "error", error: wsDeniedCS });
            const wsDeniedCD = checkWorkspaceIsolation([destination]);
            if (wsDeniedCD) return jsonResult({ status: "error", error: wsDeniedCD });

            const copyParams: Record<string, unknown> = { source, destination };
            if (typeof params.overwrite === "boolean") copyParams.overwrite = params.overwrite;
            const raw = await callGatewayTool("node.invoke", gatewayOpts, {
              nodeId,
              command: "file.copy",
              params: copyParams,
              timeoutMs: parseTimeoutMs(params.invokeTimeoutMs) ?? 30_000,
              idempotencyKey: crypto.randomUUID(),
            });
            return jsonResult(raw?.payload ?? {});
          }
          case "file_mkdir": {
            const node = readStringParam(params, "node", { required: true });
            const nodeId = await resolveNodeId(gatewayOpts, node);
            const filePath = readStringParam(params, "path", { required: true });
            const aclDeniedMk = checkTagAcl([filePath], "write");
            if (aclDeniedMk) return jsonResult({ status: "error", error: aclDeniedMk });
            const wsDeniedMk = checkWorkspaceIsolation([filePath]);
            if (wsDeniedMk) return jsonResult({ status: "error", error: wsDeniedMk });

            const mkdirParams: Record<string, unknown> = { path: filePath };
            if (typeof params.recursive === "boolean") mkdirParams.recursive = params.recursive;
            const raw = await callGatewayTool("node.invoke", gatewayOpts, {
              nodeId,
              command: "file.mkdir",
              params: mkdirParams,
              timeoutMs: parseTimeoutMs(params.invokeTimeoutMs) ?? 30_000,
              idempotencyKey: crypto.randomUUID(),
            });
            return jsonResult(raw?.payload ?? {});
          }
          case "file_trash": {
            const node = readStringParam(params, "node", { required: true });
            const nodeId = await resolveNodeId(gatewayOpts, node);
            const filePath = readStringParam(params, "path", { required: true });
            const aclDeniedTr = checkTagAcl([filePath], "write");
            if (aclDeniedTr) return jsonResult({ status: "error", error: aclDeniedTr });
            const wsDeniedTr = checkWorkspaceIsolation([filePath]);
            if (wsDeniedTr) return jsonResult({ status: "error", error: wsDeniedTr });

            const raw = await callGatewayTool("node.invoke", gatewayOpts, {
              nodeId,
              command: "file.trash",
              params: { path: filePath },
              timeoutMs: parseTimeoutMs(params.invokeTimeoutMs) ?? 30_000,
              idempotencyKey: crypto.randomUUID(),
            });
            return jsonResult(raw?.payload ?? {});
          }
          case "ops_log": {
            const node = readStringParam(params, "node", { required: true });
            const nodeId = await resolveNodeId(gatewayOpts, node);
            const opsLogParams: Record<string, unknown> = {};
            // path is needed to identify the workspace on the node
            if (typeof params.path === "string") opsLogParams.path = params.path;
            if (typeof params.sessionId === "string") opsLogParams.sessionId = params.sessionId;
            if (typeof params.command === "string") opsLogParams.command = params.command;
            if (typeof params.since === "number") opsLogParams.since = params.since;
            if (typeof params.until === "number") opsLogParams.until = params.until;
            if (typeof params.limit === "number") opsLogParams.limit = params.limit;
            if (typeof params.offset === "number") opsLogParams.offset = params.offset;

            const raw = await callGatewayTool("node.invoke", gatewayOpts, {
              nodeId,
              command: "ops.log",
              params: opsLogParams,
              timeoutMs: parseTimeoutMs(params.invokeTimeoutMs) ?? 30_000,
              idempotencyKey: crypto.randomUUID(),
            });
            return jsonResult(raw?.payload ?? {});
          }
          case "ops_undo": {
            const node = readStringParam(params, "node", { required: true });
            const nodeId = await resolveNodeId(gatewayOpts, node);
            const opId = readStringParam(params, "operationId", { required: true });
            const opsUndoParams: Record<string, unknown> = { operationId: opId };
            if (typeof params.path === "string") opsUndoParams.path = params.path;

            const raw = await callGatewayTool("node.invoke", gatewayOpts, {
              nodeId,
              command: "ops.undo",
              params: opsUndoParams,
              timeoutMs: parseTimeoutMs(params.invokeTimeoutMs) ?? 30_000,
              idempotencyKey: crypto.randomUUID(),
            });
            return jsonResult(raw?.payload ?? {});
          }
          case "ops_rollback": {
            const node = readStringParam(params, "node", { required: true });
            const nodeId = await resolveNodeId(gatewayOpts, node);
            const rollbackParams: Record<string, unknown> = {};
            if (typeof params.path === "string") rollbackParams.path = params.path;
            if (typeof params.sessionId === "string") rollbackParams.sessionId = params.sessionId;
            if (typeof params.since === "number") rollbackParams.since = params.since;
            if (typeof params.dryRun === "boolean") rollbackParams.dryRun = params.dryRun;

            const raw = await callGatewayTool("node.invoke", gatewayOpts, {
              nodeId,
              command: "ops.rollback",
              params: rollbackParams,
              timeoutMs: parseTimeoutMs(params.invokeTimeoutMs) ?? 60_000,
              idempotencyKey: crypto.randomUUID(),
            });
            return jsonResult(raw?.payload ?? {});
          }
          case "invoke": {
            const node = readStringParam(params, "node", { required: true });
            const nodeId = await resolveNodeId(gatewayOpts, node);
            const invokeCommand = readStringParam(params, "invokeCommand", { required: true });
            const invokeParamsJson =
              typeof params.invokeParamsJson === "string" ? params.invokeParamsJson.trim() : "";
            let invokeParams: unknown = {};
            if (invokeParamsJson) {
              try {
                invokeParams = JSON.parse(invokeParamsJson);
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                throw new Error(`invokeParamsJson must be valid JSON: ${message}`, {
                  cause: err,
                });
              }
            }
            // Tag workspace isolation: check file paths in invoke params
            if (invokeParams && typeof invokeParams === "object") {
              const ip = invokeParams as Record<string, unknown>;
              const invokePaths: string[] = [];
              if (typeof ip.path === "string") invokePaths.push(ip.path);
              if (typeof ip.sourcePath === "string") invokePaths.push(ip.sourcePath);
              if (typeof ip.targetPath === "string") invokePaths.push(ip.targetPath);
              if (typeof ip.workdir === "string") invokePaths.push(ip.workdir);
              if (typeof ip.cwd === "string") invokePaths.push(ip.cwd);
              if (invokePaths.length > 0) {
                const aclDeniedInvoke = checkTagAcl(invokePaths);
                if (aclDeniedInvoke) return jsonResult({ status: "error", error: aclDeniedInvoke });
                const wsDeniedInvoke = checkWorkspaceIsolation(invokePaths);
                if (wsDeniedInvoke) return jsonResult({ status: "error", error: wsDeniedInvoke });
              }
            }
            const invokeTimeoutMs = parseTimeoutMs(params.invokeTimeoutMs) ?? 30_000;
            const raw = await callGatewayTool("node.invoke", gatewayOpts, {
              nodeId,
              command: invokeCommand,
              params: invokeParams,
              timeoutMs: invokeTimeoutMs,
              idempotencyKey: crypto.randomUUID(),
            });
            return jsonResult(raw ?? {});
          }
          default:
            throw new Error(`Unknown action: ${action}`);
        }
      } catch (err) {
        const nodeLabel =
          typeof params.node === "string" && params.node.trim() ? params.node.trim() : "auto";
        const gatewayLabel =
          gatewayOpts.gatewayUrl && gatewayOpts.gatewayUrl.trim()
            ? gatewayOpts.gatewayUrl.trim()
            : "default";
        const agentLabel = agentId ?? "unknown";
        let message = err instanceof Error ? err.message : String(err);
        if (action === "invoke" && isPairingRequiredMessage(message)) {
          const requestId = extractPairingRequestId(message);
          const approveHint = requestId
            ? `Approve pairing request ${requestId} and retry.`
            : "Approve the pending pairing request and retry.";
          message = `pairing required before node invoke. ${approveHint}`;
        }
        throw new Error(
          `agent=${agentLabel} node=${nodeLabel} gateway=${gatewayLabel} action=${action}: ${message}`,
          { cause: err },
        );
      }
    },
  };
}
