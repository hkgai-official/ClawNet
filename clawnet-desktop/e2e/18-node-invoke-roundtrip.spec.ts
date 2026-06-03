// e2e/18-node-invoke-roundtrip.spec.ts
//
// P3C-agent-exec-protocol: prove the full `node.invoke.request` →
// `node.invoke.result` roundtrip across the WS gateway.
//
// Wire shape (matches macOS server + NodeEventHandler.swift:23-90):
//   in:  { type: 'push', topic: 'node.invoke.request',
//          payload: { id, command, paramsJSON?, workspaceRoot?, tagNodeAcl? } }
//   out: { type: 'request', method: 'node.invoke.result',
//          params: { id, result: <JSON-encoded string> } }
//
// We deliberately push an UNKNOWN command name (`e2e.protocol-probe`) so
// this spec stays focused on the wire round-trip and doesn't depend on
// any particular handler's policy/IO behavior. NodeEventHandler responds
// to unknown commands with `{"error":"unknown_command: <name>"}` (see
// node-event-handler.ts), which is the smallest possible reply that
// still exercises the full PushDispatcher → NodeEventHandler →
// GatewayChannel send path. Real handlers (file.search etc.) get their
// own dedicated round-trip specs (see spec 19).
//
// Two new fake-server affordances (e2e/fixtures/fake-server.ts):
//   POST /__test/push-node-invoke  → broadcast the push frame
//   GET  /__test/received-frames   → list every JSON frame the client sent
//                                    (captured by an extra ws.on('message')
//                                    listener that runs alongside the
//                                    existing hello/ping dispatcher).

import { test, expect, request as pwRequest } from '@playwright/test';
import { startFakeServer, type FakeServer } from './fixtures/fake-server';
import { launchApp, type LaunchResult } from './fixtures/launch-app';

let server: FakeServer;
let app: LaunchResult;

test.beforeEach(async () => {
  server = await startFakeServer();
  app = await launchApp({ serverURL: server.url });
});

test.afterEach(async () => {
  await app.close();
  await server.close();
});

test('node.invoke.request push → node.invoke.result reply for unknown command', async () => {
  const { window } = app;

  // --- Sign in (same shape as spec 14/15) ---
  await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await window.getByLabel(/Password/i).fill('tempPass1');
  await window.getByRole('button', { name: /Sign in/i }).click();
  await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });

  // --- Push a `node.invoke.request` for a deliberately unknown command ---
  // The payload key shape is camelCase because NodeInvokePayloadSchema
  // (src/main/features/agents/node-event-handler.ts) parses the push
  // payload directly — the camel/snake REST conversion doesn't apply to
  // raw WS frames (same convention as the P3C audit push).
  const invokeId = `invoke-${Date.now()}`;
  const ctx = await pwRequest.newContext();
  await ctx.post(`${server.url}/__test/push-node-invoke`, {
    data: {
      id: invokeId,
      command: 'e2e.protocol-probe',
    },
  });

  // --- Poll until the reply frame appears in receivedFrames ---
  // Don't sleep blindly: the WS roundtrip is sub-100ms in practice but the
  // first push may race with the post-signin reconnect handshake. Poll up
  // to 5s, breaking the moment we see the result.
  type Frame = {
    type?: string;
    method?: string;
    params?: { id?: string; result?: string };
  };
  let reply: Frame | undefined;
  let lastFrames: Frame[] = [];
  for (let i = 0; i < 50; i++) {
    const res = await ctx.get(`${server.url}/__test/received-frames`);
    lastFrames = (await res.json()) as Frame[];
    reply = lastFrames.find(
      (f) =>
        f.type === 'request' &&
        f.method === 'node.invoke.result' &&
        f.params?.id === invokeId,
    );
    if (reply) break;
    await window.waitForTimeout(100);
  }

  expect(
    reply,
    `Expected node.invoke.result frame for ${invokeId}. Frames seen: ${JSON.stringify(lastFrames)}`,
  ).toBeTruthy();
  expect(reply?.params?.result).toBeTruthy();

  // node-event-handler.ts: missing commands map entry →
  // JSON.stringify({error: `unknown_command: ${command}`}).
  const result = JSON.parse(reply!.params!.result!) as { error?: string };
  expect(result.error).toBe('unknown_command: e2e.protocol-probe');

  await ctx.dispose();
});
