// src/main/network/gateway/node-invoke-result.ts
//
// Build the envelope the server expects for `node.invoke.result`.
//
// Swift macOS (`ChatService.swift:303-311`) sends:
//   { type: 'node.invoke.result',
//     data: { id, nodeId, ok, payloadJSON } }
//
// The server's `_handle_node_invoke_result` (clawnet-server
// `websocket/handlers.py:764-789`) reads `msg_data = data.get("data", {})`,
// then validates `if not invoke_id or not node_id: return` — i.e. SILENTLY
// drops the result if `nodeId` is missing, with no error response.
// That silent drop is exactly what causes the gateway to time out after
// 30s waiting for our invoke result.
//
// The previous Win wiring used `GatewayChannel.sendRequest('node.invoke.
// result', { id, result })` which produced `{type:'request',
// method:'node.invoke.result', params:{id, result}}` — wrong type, wrong
// data wrapper, missing nodeId, missing ok flag, wrong field name
// (`result` vs `payloadJSON`). Every file op timed out.

export interface NodeInvokeResultEnvelope {
  type: 'node.invoke.result';
  data: {
    id: string;
    nodeId: string;
    ok: boolean;
    payloadJSON: string;
  };
}

/**
 * Convert a node-event-handler invoke result into the wire envelope the
 * server (and gateway) expect.
 *
 * `ok` is derived from the result JSON: any object with a string
 * `error` field is considered a failure (matches Swift's
 * `obj["error"] == nil` check at ChatService.swift:300). Anything that
 * fails to parse is also considered a failure (mirrors Swift's
 * `guard ... else { return false }`).
 */
export function buildNodeInvokeResultEnvelope(args: {
  invokeId: string;
  nodeId: string;
  resultJSON: string;
}): NodeInvokeResultEnvelope {
  return {
    type: 'node.invoke.result',
    data: {
      id: args.invokeId,
      nodeId: args.nodeId,
      ok: isOkResult(args.resultJSON),
      payloadJSON: args.resultJSON,
    },
  };
}

function isOkResult(resultJSON: string): boolean {
  try {
    const obj = JSON.parse(resultJSON) as Record<string, unknown> | null;
    if (!obj || typeof obj !== 'object') return false;
    return typeof obj.error !== 'string';
  } catch {
    return false;
  }
}
