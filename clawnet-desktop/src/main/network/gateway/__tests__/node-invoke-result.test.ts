import { describe, it, expect } from 'vitest';
import { buildNodeInvokeResultEnvelope } from '../node-invoke-result';

describe('buildNodeInvokeResultEnvelope', () => {
  // Server-side contract (clawnet-server websocket/handlers.py:764-789):
  //   data.id           = invoke_id (required)
  //   data.nodeId       = node_id  (required — server silently drops if missing)
  //   data.ok           = boolean
  //   data.payloadJSON  = result JSON string
  //
  // Mirrors Swift macOS ChatService.swift:303-311.

  it('wraps an OK result with all required fields', () => {
    const env = buildNodeInvokeResultEnvelope({
      invokeId: 'inv-1',
      nodeId: 'node-abc',
      resultJSON: JSON.stringify({ entries: [{ name: 'foo' }] }),
    });
    expect(env).toEqual({
      type: 'node.invoke.result',
      data: {
        id: 'inv-1',
        nodeId: 'node-abc',
        ok: true,
        payloadJSON: '{"entries":[{"name":"foo"}]}',
      },
    });
  });

  it('marks ok=false when the result JSON has an `error` string', () => {
    const env = buildNodeInvokeResultEnvelope({
      invokeId: 'inv-2',
      nodeId: 'node-abc',
      resultJSON: JSON.stringify({ error: 'permission denied' }),
    });
    expect(env.data.ok).toBe(false);
  });

  it('marks ok=false when the result JSON is malformed', () => {
    const env = buildNodeInvokeResultEnvelope({
      invokeId: 'inv-3',
      nodeId: 'node-abc',
      resultJSON: 'not json',
    });
    expect(env.data.ok).toBe(false);
    // payloadJSON is still passed through verbatim — server inspects it
    // on the audit / forward path.
    expect(env.data.payloadJSON).toBe('not json');
  });

  it('marks ok=false when the result is a non-object JSON (matches Swift guard)', () => {
    // Swift `JSONSerialization.jsonObject(with:) as? [String: Any]` returns
    // nil for non-dict JSON → guard let else returns false. We mirror.
    const env = buildNodeInvokeResultEnvelope({
      invokeId: 'inv-4',
      nodeId: 'node-abc',
      resultJSON: '"some string"',
    });
    expect(env.data.ok).toBe(false);
  });

  it('marks ok=true when `error` is present but not a string (e.g., null)', () => {
    // Swift's `obj["error"] == nil` check: null counts as "no error".
    const env = buildNodeInvokeResultEnvelope({
      invokeId: 'inv-5',
      nodeId: 'node-abc',
      resultJSON: JSON.stringify({ error: null, ok: true }),
    });
    expect(env.data.ok).toBe(true);
  });
});
