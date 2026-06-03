// src/main/features/agents/blob-endpoint.ts
//
// 1:1 port of macOS GatewayBlobUploader.Endpoint.fromWebSocketURL
// (Gateway/GatewayBlobUploader.swift:15-23).
// Converts ws:// → http:// and wss:// → https://, preserving host, port,
// path, and query (URLComponents behavior in Swift).
//
// Note: Node's URL class may canonicalize paths slightly differently from
// Swift's URLComponents (e.g. trailing slash handling). Tests reflect Node's
// actual output.

export interface BlobEndpoint {
  baseURL: string;
  token?: string;
}

export function deriveBlobEndpoint(wsURL: string, token: string | undefined): BlobEndpoint {
  const u = new URL(wsURL);
  u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
  const ep: BlobEndpoint = { baseURL: u.toString() };
  if (token !== undefined) ep.token = token;
  return ep;
}
