import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "../config/config.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import { authorizeHttpGatewayConnect, type ResolvedGatewayAuth } from "./auth.js";
import type { BlobStore } from "./blob-store.js";
import { sendGatewayAuthFailure, sendJson, sendMethodNotAllowed, sendText } from "./http-common.js";
import { getBearerToken } from "./http-utils.js";

const MAX_BLOB_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

// UUID v4 pattern for path matching
const BLOB_ID_PATTERN = /^\/blobs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

function readRawBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<{ ok: true; data: Buffer } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let resolved = false;

    req.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        if (!resolved) {
          resolved = true;
          resolve({ ok: false, error: "payload too large" });
        }
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (!resolved) {
        resolved = true;
        resolve({ ok: true, data: Buffer.concat(chunks) });
      }
    });

    req.on("error", () => {
      if (!resolved) {
        resolved = true;
        resolve({ ok: false, error: "request body error" });
      }
    });
  });
}

/**
 * HTTP handler for blob upload/download.
 *
 * - POST /blobs — upload raw binary, returns { blobId, size }
 * - GET /blobs/:id — download blob (one-time retrieval, blob is deleted after)
 *
 * Both endpoints require gateway Bearer auth.
 */
export function handleBlobHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    blobStore: BlobStore;
    auth: ResolvedGatewayAuth;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/blobs") {
    if (req.method !== "POST") {
      sendMethodNotAllowed(res, "POST");
      return Promise.resolve(true);
    }
    return handleBlobUpload(req, res, opts);
  }

  const match = url.pathname.match(BLOB_ID_PATTERN);
  if (match) {
    if (req.method !== "GET") {
      sendMethodNotAllowed(res, "GET");
      return Promise.resolve(true);
    }
    return handleBlobDownload(req, res, match[1]!, opts);
  }

  return Promise.resolve(false);
}

async function authenticateRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  const cfg = loadConfig();
  const token = getBearerToken(req);
  const authResult = await authorizeHttpGatewayConnect({
    auth: opts.auth,
    connectAuth: token ? { token, password: token } : null,
    req,
    trustedProxies: opts.trustedProxies ?? cfg.gateway?.trustedProxies,
    allowRealIpFallback: opts.allowRealIpFallback ?? cfg.gateway?.allowRealIpFallback,
    rateLimiter: opts.rateLimiter,
  });
  if (!authResult.ok) {
    sendGatewayAuthFailure(res, authResult);
    return false;
  }
  return true;
}

async function handleBlobUpload(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    blobStore: BlobStore;
    auth: ResolvedGatewayAuth;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<true> {
  if (!(await authenticateRequest(req, res, opts))) {
    return true;
  }

  const body = await readRawBody(req, MAX_BLOB_UPLOAD_BYTES);
  if (!body.ok) {
    if (body.error === "payload too large") {
      sendJson(res, 413, {
        error: { message: "Payload too large", type: "invalid_request_error" },
      });
    } else {
      sendJson(res, 400, {
        error: { message: body.error, type: "invalid_request_error" },
      });
    }
    return true;
  }

  const blobId = opts.blobStore.put(body.data);
  sendJson(res, 201, { blobId, size: body.data.length });
  return true;
}

async function handleBlobDownload(
  req: IncomingMessage,
  res: ServerResponse,
  blobId: string,
  opts: {
    blobStore: BlobStore;
    auth: ResolvedGatewayAuth;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<true> {
  if (!(await authenticateRequest(req, res, opts))) {
    return true;
  }

  const data = opts.blobStore.take(blobId);
  if (!data) {
    sendText(res, 404, "Not Found");
    return true;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Length", String(data.length));
  res.end(data);
  return true;
}
