import { loadConfig, resolveGatewayPort } from "../../config/config.js";
import { callGateway } from "../../gateway/call.js";
import { resolveGatewayCredentialsFromConfig, trimToUndefined } from "../../gateway/credentials.js";
import { resolveLeastPrivilegeOperatorScopesForMethod } from "../../gateway/method-scopes.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../../utils/message-channel.js";
import { readStringParam } from "./common.js";

export const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";

export type GatewayCallOptions = {
  gatewayUrl?: string;
  gatewayToken?: string;
  timeoutMs?: number;
};

type GatewayOverrideTarget = "local" | "remote";

export function readGatewayCallOptions(params: Record<string, unknown>): GatewayCallOptions {
  return {
    gatewayUrl: readStringParam(params, "gatewayUrl", { trim: false }),
    gatewayToken: readStringParam(params, "gatewayToken", { trim: false }),
    timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : undefined,
  };
}

function canonicalizeToolGatewayWsUrl(raw: string): { origin: string; key: string } {
  const input = raw.trim();
  let url: URL;
  try {
    url = new URL(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid gatewayUrl: ${input} (${message})`, { cause: error });
  }

  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`invalid gatewayUrl protocol: ${url.protocol} (expected ws:// or wss://)`);
  }
  if (url.username || url.password) {
    throw new Error("invalid gatewayUrl: credentials are not allowed");
  }
  if (url.search || url.hash) {
    throw new Error("invalid gatewayUrl: query/hash not allowed");
  }
  // Agents/tools expect the gateway websocket on the origin, not arbitrary paths.
  if (url.pathname && url.pathname !== "/") {
    throw new Error("invalid gatewayUrl: path not allowed");
  }

  const origin = url.origin;
  // Key: protocol + host only, lowercased. (host includes IPv6 brackets + port when present)
  const key = `${url.protocol}//${url.host.toLowerCase()}`;
  return { origin, key };
}

function validateGatewayUrlOverrideForAgentTools(params: {
  cfg: ReturnType<typeof loadConfig>;
  urlOverride: string;
}): { url: string; target: GatewayOverrideTarget } {
  const { cfg } = params;
  const port = resolveGatewayPort(cfg);
  const localAllowed = new Set<string>([
    `ws://127.0.0.1:${port}`,
    `wss://127.0.0.1:${port}`,
    `ws://localhost:${port}`,
    `wss://localhost:${port}`,
    `ws://[::1]:${port}`,
    `wss://[::1]:${port}`,
  ]);

  let remoteKey: string | undefined;
  const remoteUrl =
    typeof cfg.gateway?.remote?.url === "string" ? cfg.gateway.remote.url.trim() : "";
  if (remoteUrl) {
    try {
      const remote = canonicalizeToolGatewayWsUrl(remoteUrl);
      remoteKey = remote.key;
    } catch {
      // ignore: misconfigured remote url; tools should fall back to default resolution.
    }
  }

  const parsed = canonicalizeToolGatewayWsUrl(params.urlOverride);
  if (localAllowed.has(parsed.key)) {
    return { url: parsed.origin, target: "local" };
  }
  if (remoteKey && parsed.key === remoteKey) {
    return { url: parsed.origin, target: "remote" };
  }
  throw new Error(
    [
      "gatewayUrl override rejected.",
      `Allowed: ws(s) loopback on port ${port} (127.0.0.1/localhost/[::1])`,
      "Or: configure gateway.remote.url and omit gatewayUrl to use the configured remote gateway.",
    ].join(" "),
  );
}

function resolveGatewayOverrideToken(params: {
  cfg: ReturnType<typeof loadConfig>;
  target: GatewayOverrideTarget;
  explicitToken?: string;
}): string | undefined {
  if (params.explicitToken) {
    return params.explicitToken;
  }
  return resolveGatewayCredentialsFromConfig({
    cfg: params.cfg,
    env: process.env,
    modeOverride: params.target,
    remoteTokenFallback: params.target === "remote" ? "remote-only" : "remote-env-local",
    remotePasswordFallback: params.target === "remote" ? "remote-only" : "remote-env-local",
  }).token;
}

export function resolveGatewayOptions(opts?: GatewayCallOptions) {
  const cfg = loadConfig();
  const validatedOverride =
    trimToUndefined(opts?.gatewayUrl) !== undefined
      ? validateGatewayUrlOverrideForAgentTools({
          cfg,
          urlOverride: String(opts?.gatewayUrl),
        })
      : undefined;
  const explicitToken = trimToUndefined(opts?.gatewayToken);
  const token = validatedOverride
    ? resolveGatewayOverrideToken({
        cfg,
        target: validatedOverride.target,
        explicitToken,
      })
    : explicitToken;
  const timeoutMs =
    typeof opts?.timeoutMs === "number" && Number.isFinite(opts.timeoutMs)
      ? Math.max(1, Math.floor(opts.timeoutMs))
      : 30_000;
  return { url: validatedOverride?.url, token, timeoutMs };
}

export async function callGatewayTool<T = Record<string, unknown>>(
  method: string,
  opts: GatewayCallOptions,
  params?: unknown,
  extra?: { expectFinal?: boolean },
) {
  const gateway = resolveGatewayOptions(opts);
  const scopes = resolveLeastPrivilegeOperatorScopesForMethod(method);
  return await callGateway<T>({
    url: gateway.url,
    token: gateway.token,
    method,
    params,
    timeoutMs: gateway.timeoutMs,
    expectFinal: extra?.expectFinal,
    clientName: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
    clientDisplayName: "agent",
    mode: GATEWAY_CLIENT_MODES.BACKEND,
    scopes,
  });
}

/**
 * Convert a WebSocket gateway URL (ws:// or wss://) to an HTTP URL (http:// or https://).
 * Falls back to http://127.0.0.1:18789 if no URL is provided.
 */
export function resolveGatewayHttpUrl(opts?: GatewayCallOptions): string {
  const gateway = resolveGatewayOptions(opts);
  const wsUrl = gateway.url ?? DEFAULT_GATEWAY_URL;
  return wsUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

/**
 * Download a blob from the gateway via HTTP GET /blobs/:id.
 * Returns the raw binary data as a Buffer.
 */
export async function fetchGatewayBlob(blobId: string, opts?: GatewayCallOptions): Promise<Buffer> {
  const httpBaseUrl = resolveGatewayHttpUrl(opts);
  const token = resolveGatewayBlobToken(opts);

  const url = `${httpBaseUrl}/blobs/${blobId}`;
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`blob download failed: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Upload binary data to the gateway blob store via HTTP POST /blobs.
 * Returns the blobId that can be referenced in node.invoke params.
 */
export async function uploadGatewayBlob(data: Buffer, opts?: GatewayCallOptions): Promise<string> {
  const httpBaseUrl = resolveGatewayHttpUrl(opts);
  const token = resolveGatewayBlobToken(opts);

  const url = `${httpBaseUrl}/blobs`;
  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: data as unknown as BodyInit,
  });
  if (!response.ok) {
    throw new Error(`blob upload failed: ${response.status} ${response.statusText}`);
  }
  const json = (await response.json()) as { blobId: string; size: number };
  return json.blobId;
}

function resolveGatewayBlobToken(opts?: GatewayCallOptions): string | undefined {
  const gateway = resolveGatewayOptions(opts);
  if (gateway.token) return gateway.token;
  const cfg = loadConfig();
  const creds = resolveGatewayCredentialsFromConfig({ cfg, env: process.env });
  return creds.token ?? creds.password;
}
