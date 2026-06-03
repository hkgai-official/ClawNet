import { randomUUID } from "node:crypto";
import type { GatewayWsClient } from "./server/ws-types.js";

export type NodeFileAccess = {
  mode: "deny" | "scoped" | "full";
  allowedPaths?: string[];
  deniedPaths?: string[];
  updatedAtMs?: number;
};

export type NodeSession = {
  nodeId: string;
  connId: string;
  client: GatewayWsClient;
  displayName?: string;
  platform?: string;
  version?: string;
  coreVersion?: string;
  uiVersion?: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  remoteIp?: string;
  caps: string[];
  commands: string[];
  permissions?: Record<string, boolean>;
  fileAccess?: NodeFileAccess;
  tagFileAccess?: Record<string, { allowedPaths: string[]; deniedPaths: string[] }>;
  pathEnv?: string;
  connectedAtMs: number;
  /** When true, this node is proxied by an operator connection. */
  proxy?: boolean;
};

type PendingInvoke = {
  nodeId: string;
  command: string;
  resolve: (value: NodeInvokeResult) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type NodeInvokeResult = {
  ok: boolean;
  payload?: unknown;
  payloadJSON?: string | null;
  error?: { code?: string; message?: string } | null;
};

export class NodeRegistry {
  private nodesById = new Map<string, NodeSession>();
  private nodesByConn = new Map<string, string>();
  private pendingInvokes = new Map<string, PendingInvoke>();
  /** Maps operator connId → set of proxy nodeIds registered by that operator. */
  readonly proxyNodesByConn = new Map<string, Set<string>>();

  register(client: GatewayWsClient, opts: { remoteIp?: string | undefined }) {
    const connect = client.connect;
    const nodeId = connect.device?.id ?? connect.client.id;
    const caps = Array.isArray(connect.caps) ? connect.caps : [];
    const commands = Array.isArray((connect as { commands?: string[] }).commands)
      ? ((connect as { commands?: string[] }).commands ?? [])
      : [];
    const permissions =
      typeof (connect as { permissions?: Record<string, boolean> }).permissions === "object"
        ? ((connect as { permissions?: Record<string, boolean> }).permissions ?? undefined)
        : undefined;
    const pathEnv =
      typeof (connect as { pathEnv?: string }).pathEnv === "string"
        ? (connect as { pathEnv?: string }).pathEnv
        : undefined;
    const session: NodeSession = {
      nodeId,
      connId: client.connId,
      client,
      displayName: connect.client.displayName,
      platform: connect.client.platform,
      version: connect.client.version,
      coreVersion: (connect as { coreVersion?: string }).coreVersion,
      uiVersion: (connect as { uiVersion?: string }).uiVersion,
      deviceFamily: connect.client.deviceFamily,
      modelIdentifier: connect.client.modelIdentifier,
      remoteIp: opts.remoteIp,
      caps,
      commands,
      permissions,
      pathEnv,
      connectedAtMs: Date.now(),
    };
    this.nodesById.set(nodeId, session);
    this.nodesByConn.set(client.connId, nodeId);
    return session;
  }

  unregister(connId: string): string | null {
    const nodeId = this.nodesByConn.get(connId);
    if (!nodeId) {
      return null;
    }
    this.nodesByConn.delete(connId);
    this.nodesById.delete(nodeId);
    for (const [id, pending] of this.pendingInvokes.entries()) {
      if (pending.nodeId !== nodeId) {
        continue;
      }
      clearTimeout(pending.timer);
      pending.reject(new Error(`node disconnected (${pending.command})`));
      this.pendingInvokes.delete(id);
    }
    return nodeId;
  }

  listConnected(): NodeSession[] {
    return [...this.nodesById.values()];
  }

  get(nodeId: string): NodeSession | undefined {
    return this.nodesById.get(nodeId);
  }

  async invoke(params: {
    nodeId: string;
    command: string;
    params?: unknown;
    timeoutMs?: number;
    idempotencyKey?: string;
  }): Promise<NodeInvokeResult> {
    const node = this.nodesById.get(params.nodeId);
    if (!node) {
      return {
        ok: false,
        error: { code: "NOT_CONNECTED", message: "node not connected" },
      };
    }
    const requestId = randomUUID();
    const payload = {
      id: requestId,
      nodeId: params.nodeId,
      command: params.command,
      paramsJSON:
        "params" in params && params.params !== undefined ? JSON.stringify(params.params) : null,
      timeoutMs: params.timeoutMs,
      idempotencyKey: params.idempotencyKey,
    };
    const ok = this.sendEventToSession(node, "node.invoke.request", payload);
    if (!ok) {
      return {
        ok: false,
        error: { code: "UNAVAILABLE", message: "failed to send invoke to node" },
      };
    }
    const timeoutMs = typeof params.timeoutMs === "number" ? params.timeoutMs : 30_000;
    return await new Promise<NodeInvokeResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingInvokes.delete(requestId);
        resolve({
          ok: false,
          error: { code: "TIMEOUT", message: "node invoke timed out" },
        });
      }, timeoutMs);
      this.pendingInvokes.set(requestId, {
        nodeId: params.nodeId,
        command: params.command,
        resolve,
        reject,
        timer,
      });
    });
  }

  handleInvokeResult(params: {
    id: string;
    nodeId: string;
    ok: boolean;
    payload?: unknown;
    payloadJSON?: string | null;
    error?: { code?: string; message?: string } | null;
  }): boolean {
    const pending = this.pendingInvokes.get(params.id);
    if (!pending) {
      return false;
    }
    if (pending.nodeId !== params.nodeId) {
      return false;
    }
    clearTimeout(pending.timer);
    this.pendingInvokes.delete(params.id);
    pending.resolve({
      ok: params.ok,
      payload: params.payload,
      payloadJSON: params.payloadJSON ?? null,
      error: params.error ?? null,
    });
    return true;
  }

  /**
   * Register a proxy node on behalf of an operator connection.
   * Invoke requests for this node are delivered as events to the operator's connection.
   */
  registerProxy(
    client: GatewayWsClient,
    opts: {
      nodeId: string;
      commands: string[];
      displayName?: string;
      platform?: string;
      deviceFamily?: string;
      remoteIp?: string;
      fileAccess?: NodeFileAccess;
      tagFileAccess?: Record<string, { allowedPaths: string[]; deniedPaths: string[] }>;
    },
  ): NodeSession {
    // Single-device constraint: unregister any OTHER proxy nodes from the same operator
    const existingProxies = this.proxyNodesByConn.get(client.connId);
    if (existingProxies) {
      for (const oldNodeId of [...existingProxies]) {
        if (oldNodeId !== opts.nodeId) {
          this.unregisterProxy(oldNodeId, client.connId);
        }
      }
    }

    const session: NodeSession = {
      nodeId: opts.nodeId,
      connId: client.connId,
      client,
      displayName: opts.displayName,
      platform: opts.platform,
      deviceFamily: opts.deviceFamily,
      remoteIp: opts.remoteIp,
      caps: [],
      commands: opts.commands,
      fileAccess: opts.fileAccess,
      tagFileAccess: opts.tagFileAccess,
      connectedAtMs: Date.now(),
      proxy: true,
    };
    this.nodesById.set(opts.nodeId, session);
    // Track proxy nodes in a separate set keyed by operator connId so we can
    // clean up all proxied nodes when the operator disconnects.
    if (!this.proxyNodesByConn.has(client.connId)) {
      this.proxyNodesByConn.set(client.connId, new Set());
    }
    this.proxyNodesByConn.get(client.connId)!.add(opts.nodeId);
    return session;
  }

  /**
   * Unregister a single proxy node. Returns the nodeId if found, null otherwise.
   */
  unregisterProxy(nodeId: string, operatorConnId: string): string | null {
    const node = this.nodesById.get(nodeId);
    if (!node || !node.proxy || node.connId !== operatorConnId) {
      return null;
    }
    this.nodesById.delete(nodeId);
    const proxySet = this.proxyNodesByConn.get(operatorConnId);
    if (proxySet) {
      proxySet.delete(nodeId);
      if (proxySet.size === 0) {
        this.proxyNodesByConn.delete(operatorConnId);
      }
    }
    // Reject pending invokes for this node.
    for (const [id, pending] of this.pendingInvokes.entries()) {
      if (pending.nodeId !== nodeId) continue;
      clearTimeout(pending.timer);
      pending.reject(new Error(`proxy node unregistered (${pending.command})`));
      this.pendingInvokes.delete(id);
    }
    return nodeId;
  }

  /**
   * Unregister all proxy nodes owned by an operator connection.
   * Called when the operator disconnects.
   */
  unregisterAllProxies(operatorConnId: string): string[] {
    const proxySet = this.proxyNodesByConn.get(operatorConnId);
    if (!proxySet) return [];
    const removed: string[] = [];
    for (const nodeId of proxySet) {
      const node = this.nodesById.get(nodeId);
      if (node?.proxy && node.connId === operatorConnId) {
        this.nodesById.delete(nodeId);
        for (const [id, pending] of this.pendingInvokes.entries()) {
          if (pending.nodeId !== nodeId) continue;
          clearTimeout(pending.timer);
          pending.reject(new Error(`proxy node disconnected (${pending.command})`));
          this.pendingInvokes.delete(id);
        }
        removed.push(nodeId);
      }
    }
    this.proxyNodesByConn.delete(operatorConnId);
    return removed;
  }

  sendEvent(nodeId: string, event: string, payload?: unknown): boolean {
    const node = this.nodesById.get(nodeId);
    if (!node) {
      return false;
    }
    return this.sendEventToSession(node, event, payload);
  }

  private sendEventInternal(node: NodeSession, event: string, payload: unknown): boolean {
    try {
      node.client.socket.send(
        JSON.stringify({
          type: "event",
          event,
          payload,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  private sendEventToSession(node: NodeSession, event: string, payload: unknown): boolean {
    return this.sendEventInternal(node, event, payload);
  }
}
