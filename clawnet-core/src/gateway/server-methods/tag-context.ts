import {
  setSessionTagContext,
  getSessionTagContext,
  clearSessionTagContext,
  type TagContext,
  type TagNodeAcl,
} from "../tag-context.js";
import type { GatewayRequestHandlers } from "./types.js";
import { resolveTagWorkspaceDir, ensureAgentWorkspace } from "../../agents/workspace.js";
import { promises as fs } from "node:fs";
import path from "node:path";

function isValidTagContext(p: Record<string, unknown>): p is {
  sessionKey: string;
  tagId: string;
  tagName: string;
  workspaceId: string;
  tagDisplayName?: string;
  nodeAcl?: { allowedPaths?: string[]; deniedPaths?: string[] };
} {
  return (
    typeof p.sessionKey === "string" &&
    p.sessionKey.length > 0 &&
    typeof p.tagId === "string" &&
    p.tagId.length > 0 &&
    typeof p.tagName === "string" &&
    typeof p.workspaceId === "string"
  );
}

export const tagContextHandlers: GatewayRequestHandlers = {
  /**
   * Set tag context for a session.
   * Called by the server before starting an agent run so the gateway
   * loads workspace bootstrap files from the correct tag workspace.
   */
  "tag.context.set": ({ params, respond }) => {
    const p = params;
    if (!isValidTagContext(p)) {
      respond(false, undefined, {
        code: -32602,
        message: "sessionKey, tagId, tagName, and workspaceId are required",
      });
      return;
    }

    const nodeAcl: TagNodeAcl | undefined =
      p.nodeAcl && typeof p.nodeAcl === "object"
        ? {
            allowedPaths: Array.isArray(p.nodeAcl.allowedPaths)
              ? (p.nodeAcl.allowedPaths as string[])
              : [],
            deniedPaths: Array.isArray(p.nodeAcl.deniedPaths)
              ? (p.nodeAcl.deniedPaths as string[])
              : [],
          }
        : undefined;

    const rawAccessMode = (p as Record<string, unknown>).accessMode;
    const accessMode: "rw" | "ro" | undefined =
      rawAccessMode === "rw" || rawAccessMode === "ro" ? rawAccessMode : undefined;

    const rawA2aMode = (p as Record<string, unknown>).a2aMode;
    const a2aMode = rawA2aMode === true ? true : undefined;

    const rawIsMain = (p as Record<string, unknown>).isMain;
    const isMain = rawIsMain === true ? true : undefined;

    const ctx: TagContext = {
      tagId: p.tagId,
      tagName: p.tagName,
      tagDisplayName: typeof p.tagDisplayName === "string" ? p.tagDisplayName : undefined,
      workspaceId: p.workspaceId,
      nodeAcl,
      accessMode,
      a2aMode,
      isMain,
    };

    setSessionTagContext(p.sessionKey, ctx);
    console.log(
      `[tag-ctx-set] stored sessionKey="${p.sessionKey}" workspaceId="${ctx.workspaceId}"`,
    );
    respond(true, { ok: true }, undefined);
  },

  /** Get the current tag context for a session. */
  "tag.context.get": ({ params, respond }) => {
    const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey : "";
    if (!sessionKey) {
      respond(false, undefined, {
        code: -32602,
        message: "sessionKey is required",
      });
      return;
    }
    const ctx = getSessionTagContext(sessionKey);
    respond(true, ctx ?? null, undefined);
  },

  /** Clear tag context for a session. */
  "tag.context.clear": ({ params, respond }) => {
    const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey : "";
    if (!sessionKey) {
      respond(false, undefined, {
        code: -32602,
        message: "sessionKey is required",
      });
      return;
    }
    clearSessionTagContext(sessionKey);
    respond(true, { ok: true }, undefined);
  },

  "tag.workspace.init": async ({ params, respond }) => {
    const workspaceId = typeof params.workspaceId === "string" ? params.workspaceId : "";
    if (!workspaceId) {
      respond(false, undefined, { code: -32602, message: "workspaceId required" });
      return;
    }

    const dir = resolveTagWorkspaceDir(workspaceId);
    await ensureAgentWorkspace({ dir, ensureBootstrapFiles: true });
    await fs.mkdir(path.join(dir, "files"), { recursive: true });
    respond(true, { ok: true, path: dir }, undefined);
  },
};
