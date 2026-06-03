import { app, BrowserWindow, ipcMain, protocol } from 'electron';
import {
  reportedPlatformLabel,
  reportedDeviceFamilyLabel,
  resolveDisplayName,
} from './core/platform-identity';
import { AppPaths } from './core/paths';
import { installCrashReporter } from './core/crash-reporter';
import { installE2EProxy, type E2EProxyHandle } from './e2e-proxy';
import { createLogger } from './core/logger';
import { IpcRouter } from './core/ipc-router';
import { IpcEvents } from './core/ipc-events';
import { InstanceIdentity } from './core/identity/instance-identity';
import { createDeviceIdentity } from './core/identity/device-identity';
import { createKvStore } from './store/kv-store';
import { SettingsService } from './features/settings/settings.service';
import { registerSettingsHandlers } from './features/settings/settings.handlers';
import { CredentialStore } from './network/credential-store';
import { AuthManager } from './network/auth-manager';
import { NetworkMonitor } from './network/network-monitor';
import { ConnectionManager } from './network/connection-manager';
import { GatewayChannel } from './network/gateway/gateway-channel';
import { PushDispatcher } from './network/gateway/push';
import { AuthService } from './features/auth/auth.service';
import { registerAuthHandlers } from './features/auth/auth.handlers';
import { emitAuthState, emitAuthUserSwitched } from './features/auth/auth.events';
import { loadServerConfig } from './core/server-config';
import { SqliteConversationStore } from './store/sqlite-conversation-store';
import { openDatabase } from './store/db/schema';
import { migrateJsonToSqlite } from './store/migration-shim';
import { ChatService } from './features/chat/chat.service';
import { FileService } from './network/file-service';
import { ChatEventHandler } from './features/chat/chat-event-handler';
import { registerChatHandlers, defaultChatHandlerDeps } from './features/chat/chat.handlers';
import {
  emitChatMessageCreated,
  emitStreamStart, emitStreamDelta, emitStreamEnd, emitStreamCancelled,
  emitUploadProgress, emitUploadFailed, emitChatMessageReplaced,
  emitDownloadStarted, emitDownloadProgress, emitDownloadCompleted, emitDownloadFailed,
} from './features/chat/chat.events';
import { PlaybackEngine } from './features/chat/stream/playback-engine';
import { HttpClient } from './network/http-client';
import { createMainWindow } from './window';
import { Requests as IpcRequests } from '../shared/ipc-contract';
import { AgentService } from './features/agents/agent.service';
import { DialogService } from './features/agents/dialog.service';
import { DiscoveryService } from './features/agents/discovery.service';
import { TaskService } from './features/agents/task.service';
import { AuditService } from './features/audit/audit.service';
import { CommandPolicy } from './features/agents/command-policy';
import { BookmarkStore } from './store/bookmark-store';
import { AppAuditLogger, OperationLogger } from './store/operation-logger';
import { FileAccessService } from './features/settings/file-access.service';
import { AgentEventBus } from './features/agents/agent-event-bus';
import { makeFileSearchHandler } from './features/agents/commands/file-search';
import { makeFileTrashHandler } from './features/agents/commands/file-trash';
import { makeFileStatHandler } from './features/agents/commands/file-stat';
import { makeFileMkdirHandler } from './features/agents/commands/file-mkdir';
import { makeFileRenameHandler } from './features/agents/commands/file-rename';
import { makeFileMoveHandler } from './features/agents/commands/file-move';
import { makeFileCopyHandler } from './features/agents/commands/file-copy';
import { makeFileListHandler } from './features/agents/commands/file-list';
import { makeFileWriteHandler } from './features/agents/commands/file-write';
import { makeFileReadHandler } from './features/agents/commands/file-read';
import { BlobClient } from './features/agents/blob-client';
import { deriveBlobEndpoint, type BlobEndpoint } from './features/agents/blob-endpoint';
import { makeOpsLogHandler } from './features/agents/commands/ops-log';
import { makeOpsUndoHandler } from './features/agents/commands/ops-undo';
import { makeOpsRollbackHandler } from './features/agents/commands/ops-rollback';
import { executeReverseAction } from './features/agents/undo-executor';
import { NodeEventHandler } from './features/agents/node-event-handler';
import { buildNodeInvokeResultEnvelope } from './network/gateway/node-invoke-result';
import { registerAgentsHandlers } from './features/agents/agents.handlers';
import { registerAuditHandlers } from './features/audit/audit.handlers';
import { registerFileAccessHandlers } from './features/settings/file-access.handlers';
import { ContactService } from './features/contacts/contact.service';
import { registerContactsHandlers } from './features/contacts/contacts.handlers';
import { TagService } from './features/tags/tag.service';
import { registerTagsHandlers } from './features/tags/tags.handlers';
import { ProfileService } from './features/profile/profile.service';
import { registerProfileHandlers } from './features/profile/profile.handlers';
import { NotificationService } from './features/notifications/notification.service';
import { registerFilesHandlers } from './features/files/files.handlers';
import { registerShellHandlers } from './features/shell/shell.handlers';
import { autoUpdater } from 'electron-updater';
import { UpdateService } from './features/update/update.service';
import { registerUpdateHandlers } from './features/update/update.handlers';
import { join as pathJoin } from 'node:path';
import { pruneOldLogs } from './utils/log-rotation';
import { handleRendererError, type RendererErrorPayload } from './core/renderer-error-handler';
import { installProtocolBridge } from './core/protocol-bridge';

// Must be called synchronously before app.whenReady().
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'clawnet-file',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false,
    },
  },
]);

AppPaths.initialize();
installCrashReporter({ logsDir: AppPaths.logs() });

const log = createLogger({
  logsDir: AppPaths.logs(),
  subsystem: 'ai.clawnet.desktop',
  category: 'main',
});

void log.info('main process boot', {
  instance: InstanceIdentity.get(),
  userData: AppPaths.userData(),
});

/**
 * Node commands this client can execute. Sent to the server in the
 * `node.capabilities` envelope after WS auth_success so the server can
 * register this WS as a proxy node and route `node.invoke.request`
 * events here. Must stay in sync with the handlers registered on the
 * `NodeEventHandler.commands` map below. Mirrors the macOS list in
 * `ChatService.swift:registerNodeCapabilities`.
 */
const NODE_CAPABILITY_COMMANDS = [
  'file.read', 'file.write', 'file.stat', 'file.list',
  'file.search',
  'file.move', 'file.rename', 'file.copy', 'file.mkdir', 'file.trash',
  'ops.log', 'ops.undo', 'ops.rollback',
];

const prefsKv = createKvStore({ cwd: AppPaths.userData(), name: 'prefs' });
// Persistent per-install device identity. Used as `client_id` in the WS
// hello frame so the server can register this client as a desktop node
// capable of executing agent commands. macOS does the same — the server
// keys "device online" tracking off this id.
const deviceIdentity = createDeviceIdentity({
  get: (k) => prefsKv.get<string>(k),
  set: (k, v) => prefsKv.set(k, v),
});

const creds = new CredentialStore(AppPaths.credentialsFile());

const initialServerURL = loadServerConfig(AppPaths.downloadsServerConfig());
const auth = new AuthManager({
  serverBaseURL: initialServerURL,
  credentialStore: creds,
});

const networkMonitor = new NetworkMonitor({ intervalMs: 5000 });
const router = new IpcRouter();
const events = new IpcEvents(() => BrowserWindow.getAllWindows().map((w) => w.webContents));

ipcMain.on('renderer.error', (_e, payload: unknown) => {
  if (typeof payload === 'object' && payload !== null && 'kind' in payload) {
    handleRendererError(AppPaths.logs(), payload as RendererErrorPayload);
  }
});

let gateway: GatewayChannel | null = null;
let currentBlobEndpoint: BlobEndpoint | null = null;
const pushDispatcher = new PushDispatcher();

// Diagnostic subscribers — surface the server's reply to our
// `node.capabilities` send into the on-disk log. Without these, when the
// agent reports `paired:true, connected:false`, we can't tell whether
// (a) the server replied `node.capabilities.registered` (success — bind
//     was attempted but later cleaned up), (b) the server replied with
// an `error` frame (registration outright failed for a reason we should
// see), or (c) the server replied with nothing (silent failure / handler
// crashed mid-flight).
pushDispatcher.subscribe('node.capabilities.registered', (data) => {
  void log.info('node.capabilities.registered RECEIVED', {
    data: safePreview(data),
  });
});
pushDispatcher.subscribe('error', (data) => {
  void log.warn('server error frame RECEIVED', { data: safePreview(data) });
});

function safePreview(v: unknown): string {
  try { return JSON.stringify(v).slice(0, 400); }
  catch { return '[unserializable]'; }
}

// E2E only: when the harness wires `CLAWNET_E2E_PROXY=socks5h://host:port`
// (used by the prod two-user A2A spec to give each Electron instance a
// distinct egress IP), install undici dispatcher + ws agent so all
// outbound traffic from this main process routes through the SOCKS5 hop.
const e2eProxyUrl = process.env.CLAWNET_E2E_PROXY;
const e2eProxy: E2EProxyHandle | null = e2eProxyUrl
  ? installE2EProxy(e2eProxyUrl)
  : null;
if (e2eProxy) {
  console.log('[main] E2E proxy installed:', e2eProxyUrl);
}

const connection = new ConnectionManager({
  connect: async () => {
    const token = await auth.ensureValidAccessToken();
    // Server-proxied WS endpoint (matches macOS ServerConnection.connect at
    // ServerConnection.swift:27-38). The old direct-gateway path /api/v1/ws
    // is deprecated and returns 403.
    const wsURL = httpToWs(auth.baseURL()) + '/ws/v1/messages?token=' + encodeURIComponent(token);
    gateway = new GatewayChannel({
      url: wsURL,
      // /ws/v1/messages auths via token in the query string and replies
      // `auth_success`. No legacy hello handshake — node-role registration
      // happens via a separate `node.capabilities` envelope sent AFTER
      // connect (see below). The server ignores any other early frame.
      onPush: (frame) => pushDispatcher.dispatch(frame),
      onServerMessage: (frame) => pushDispatcher.dispatchServerMessage(frame),
      onDisconnect: (reason) => {
        // Surface disconnect reason in the on-disk log — earlier debugging
        // for `paired:true, connected:false` is blind without this because
        // a WS that drops right after `node.capabilities` looks identical
        // (from the renderer's POV) to one that never drops.
        void log.warn('gateway disconnected', { reason });
        connection.handleDisconnect(reason);
      },
      ...(e2eProxy ? { wsFactory: e2eProxy.wsFactory } : {}),
    });
    currentBlobEndpoint = deriveBlobEndpoint(wsURL, token);
    await gateway.connect();

    // Register this WS as a proxy node so the server routes
    // `node.invoke.request` events here. Without this the server only
    // tracks the connection as chat-only and the node shows up as
    // `paired: true, connected: false` in `claw nodes action=status`.
    // 1:1 of macOS `ChatService.swift:registerNodeCapabilities` which
    // sends the same envelope right after `auth_success`.
    //
    // **Double-send (immediate + 1s later)** — the server has a race
    // between (a) the OLD-WS cleanup that removes our nodeId from
    // `ws_manager.proxy_node_registry` and (b) the NEW-WS handler that
    // sets it. If our `node.capabilities` arrives before the old WS's
    // disconnect cleanup runs, the cleanup wipes our entry seconds
    // later and the device shows up as `paired:true, connected:false`
    // forever. Swift macOS dodges this implicitly by spending ~tens of
    // ms on setup between auth_success and the send; Win Electron sends
    // immediately. The simplest fix is to send twice — the second
    // arrival (~1s after) is the last writer no matter how the race
    // played out the first time. The server is idempotent on
    // re-registration of the same nodeId.
    //
    // `fileAccess` is intentionally omitted: server is the source of
    // truth (see clawnet-server `websocket/handlers.py:674-708`).
    const nodeCapabilitiesEnvelope = {
      type: 'node.capabilities',
      data: {
        nodeId: deviceIdentity.get(),
        commands: NODE_CAPABILITY_COMMANDS,
        // `displayName` reflects the real host name (so a Win Electron
        // session shows up as that PC's name); `platform` and
        // `deviceFamily` are pinned to `macos`/`Mac` because the
        // server-side per-platform allowlist only populates macos
        // commands — see `core/platform-identity.ts` for the WHY.
        displayName: resolveDisplayName(),
        platform: reportedPlatformLabel(),
        deviceFamily: reportedDeviceFamilyLabel(),
      },
    };
    const sentGateway = gateway;
    sentGateway.sendEnvelope(nodeCapabilitiesEnvelope);
    void log.info('node.capabilities sent (initial)', {
      nodeId: nodeCapabilitiesEnvelope.data.nodeId,
    });
    setTimeout(() => {
      // Guard: only re-send if THIS gateway instance is still the live
      // one. If the connection has since dropped + reconnected, a fresh
      // `connect()` cycle will fire its own pair of sends — we don't
      // want to spray onto a stale gateway.
      if (gateway === sentGateway && sentGateway.isConnected()) {
        try {
          sentGateway.sendEnvelope(nodeCapabilitiesEnvelope);
          void log.info('node.capabilities sent (re-send +1s)', {
            nodeId: nodeCapabilitiesEnvelope.data.nodeId,
          });
        } catch (e) {
          void log.warn('node.capabilities re-send failed', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }, 1000);

    // Re-sync fileAccess settings from server now that we have a
    // valid auth token. The startup-time sync at app.whenReady() fires
    // BEFORE the user logs in and gets 401 → silently caches null
    // forever, which breaks ops.* handlers that rely on
    // `fileAccessSvc.getEffectiveSettings().allowedPaths` to find a
    // workspace root. file.* handlers compensate via .clawnet ancestor
    // walks + tagAcl hints, so they kept working — but ops.log /
    // ops.undo had no equivalent fallback. Best-effort; failure here
    // just keeps the cache null and the operator can still drive file
    // ops by passing explicit paths.
    void fileAccessSvc
      .syncFromServer()
      .then((s) => {
        void log.info('fileAccess synced from server', {
          mode: s.mode,
          allowedPathsCount: s.allowedPaths.length,
        });
      })
      .catch((e) => {
        void log.warn('fileAccess sync failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      });
  },
  disconnect: async () => {
    gateway?.disconnect();
    gateway = null;
    currentBlobEndpoint = null;
  },
  networkMonitor,
});

connection.onStatusChanged((e) => events.broadcast('connection.statusChanged', e));

router.register('connection.status', {
  input: IpcRequests['connection.status'].input,
  output: IpcRequests['connection.status'].output,
  handler: async () => connection.status(),
});
router.register('connection.manualReconnect', {
  input: IpcRequests['connection.manualReconnect'].input,
  output: IpcRequests['connection.manualReconnect'].output,
  handler: async () => { connection.manualReconnect(); },
});

const settingsSvc = new SettingsService(prefsKv, (change) => {
  events.broadcast('settings.changed', change);
});
registerSettingsHandlers(router, settingsSvc);

const LAST_USER_ID_KEY = 'auth.lastUserId';

// Cross-account leak guard: when the just-logged-in user doesn't match
// the one we saw last on this install, wipe per-user local caches so
// account A's conversations / file-access settings can't surface in
// account B's UI. `device.id`, theme, and language live in `prefsKv`
// alongside `lastUserId` and are intentionally NOT cleared — they're
// install-scoped (device.id) or app-scoped preferences.
//
// `previous === undefined` is treated as "untrusted local state" and
// also triggers the wipe. This covers:
//   1. First login after upgrading from a build that didn't track
//      `lastUserId` — the on-disk DB may belong to whoever the user
//      was before the upgrade, so we can't assume it's theirs.
//   2. Credentials cleared externally (e.g. token store wiped) and the
//      next login lands as a different account.
// New installs hit the same code path but the DB is already empty, so
// the wipe is a no-op.
//
// Runs BEFORE `connect()` in AuthService so WS pushes from the new
// account never land in the old account's DB rows. The references
// below (chatStore, bookmarks, fileAccessSvc) are declared later in
// this file; closure resolution happens at call time, well after
// module init.
async function handleLoginSuccess(user: { id: string }): Promise<void> {
  const previous = prefsKv.get<string>(LAST_USER_ID_KEY);
  if (previous === user.id) return;
  void log.info('clearing local caches on login', {
    previous: previous ?? '(none)',
    next: user.id,
  });
  chatStore.clearAll();
  await bookmarks.clear();
  fileAccessSvc.clearCache();
  emitAuthUserSwitched(events, user.id);
  prefsKv.set(LAST_USER_ID_KEY, user.id);
}

const authSvc = new AuthService({
  authManager: auth,
  connectionManager: connection,
  emitState: (s) => emitAuthState(events, s),
  onLoginSuccess: handleLoginSuccess,
});
registerAuthHandlers(router, authSvc);

// Chat wiring — depends on auth + gateway + connection already wired above.
const chatDb = openDatabase(pathJoin(AppPaths.userData(), 'clawnet.db'));
const chatStore = new SqliteConversationStore(chatDb);
migrateJsonToSqlite(prefsKv, chatStore);
const chatHttp = new HttpClient({
  baseURL: auth.baseURL(),
  getAccessToken: async () => auth.ensureValidAccessToken(),
  onUnauthorized: async () => auth.refreshAccessToken(),
});
// Keep chatHttp's base URL in lockstep with the auth-manager. Otherwise a
// user switching server URLs via the Login form would hit the old server for
// every non-auth REST call (chat/agents/audit/file-access all share chatHttp).
const fileSvc = new FileService({
  http: chatHttp,
  baseURL: auth.baseURL(),
  getAccessToken: async () => auth.ensureValidAccessToken(),
});
auth.onServerURLChanged((url) => {
  chatHttp.updateBaseURL(url);
  fileSvc.setBaseURL(url);
});
const chatSvc = new ChatService({
  http: chatHttp,
  store: chatStore,
  files: fileSvc,
  // Route sendText through the WS so server triggers the LLM reply
  // (matches macOS ChatService.swift:540-548). Gateway is mutable —
  // ConnectionManager constructs it lazily in connect().
  getGateway: () => gateway,
  // Optimistic messages need the real user identity so MessageBubble
  // renders them on the user's side of the chat.
  getCurrentUser: () => {
    const u = authSvc.getCurrentUser();
    if (!u) return null;
    return { id: u.id, name: u.displayName ?? u.username };
  },
  // Mirror locally-initiated sends to the renderer message-list. WS-driven
  // creates are still handled by ChatEventHandler below.
  onMessageCreated: (m) => emitChatMessageCreated(events, m),
  // Per-chunk upload progress → renderer's `useUploadStore` (keyed by tempId).
  onUploadProgress: (e) => emitUploadProgress(events, e),
  // Optimistic-to-real swap → renderer's `useMessages` patches the cache.
  onMessageReplaced: (e) => emitChatMessageReplaced(events, e),
  // Upload failure → renderer flips the bubble into red Retry state.
  onUploadFailed: (e) => emitUploadFailed(events, e),
});
const playbackEngine = new PlaybackEngine({
  onStart: (e) => emitStreamStart(events, e),
  onDelta: (e) => emitStreamDelta(events, e),
  onEnd: (e) => emitStreamEnd(events, e),
  onCancelled: (e) => emitStreamCancelled(events, e),
});
// Desktop-notification wiring (G3 from round-6 audit). Notifications fire
// for incoming messages when the app window is unfocused and the message
// is not from the current user. The notifier is constructed first; the
// chat-event-handler picks it up via the option below.
const notifier = new NotificationService();
void new ChatEventHandler({
  store: chatStore,
  dispatcher: pushDispatcher,
  engine: playbackEngine,
  onCreated: (m) => emitChatMessageCreated(events, m),
  notifier,
  getCurrentUserId: () => authSvc.getCurrentUser()?.id ?? null,
  // BrowserWindow.getFocusedWindow() returns null when nothing is focused;
  // we treat both null and "no windows" as unfocused so notifications fire.
  isAppFocused: () => BrowserWindow.getFocusedWindow() !== null,
});
registerChatHandlers(
  router,
  chatSvc,
  fileSvc,
  defaultChatHandlerDeps(playbackEngine, chatStore, {
    emitDownloadStarted: (e) => emitDownloadStarted(events, e),
    emitDownloadProgress: (e) => emitDownloadProgress(events, e),
    emitDownloadCompleted: (e) => emitDownloadCompleted(events, e),
    emitDownloadFailed: (e) => emitDownloadFailed(events, e),
  }),
);

// E2E-only inspection channel: expose NotificationService.emittedLog so
// the round-6 Stage 38 spec can assert "notification would have fired"
// without the OS-level Notification actually popping (we suppress those
// in headless mode to keep the host user undisturbed). The channel is
// registered unconditionally — it just returns an empty array in normal
// runs, since nothing else writes to the log without notifier being
// wired (which it always is in main, but renderer can't reach the
// router without a fake-server providing the gateway).
ipcMain.handle('__test.notifications.log', () => notifier.getEmittedLog());

// Diagnostic: dump the PushDispatcher's last ~50 incoming frames so
// we can see exactly what the server pushed. Use from the renderer
// devtools console:
//   await window.clawnet.invoke('__diag.recentPushes', null)
// Pairs with `currentUserId` so we can verify dialog_approval skip rules
// (the rule "skip card when initiatorOwnerId === currentUserId" is the
// most common cause of "expected card didn't render").
ipcMain.handle('__diag.recentPushes', () => ({
  currentUserId: authSvc.getCurrentUser()?.id ?? null,
  frames: pushDispatcher.getDiagBuffer(),
  wsConnected: gateway?.isConnected() ?? false,
  // Every parsed WS frame's type (auth_success / pong / push / etc).
  // Lets the prod two-user spec see "did server send anything at all"
  // independent of whether the dispatcher routed it.
  wsFrameLog: gateway?.getFrameLog() ?? [],
}));

// P1E-core: agent governance, audit, file-access.
const bookmarks = new BookmarkStore(AppPaths.fileAccessJson());
const appAuditLogger = new AppAuditLogger(pathJoin(AppPaths.logs()));
// operationLogger: workspace-local JSONL logger for ops.log/undo/rollback handlers.
const operationLogger = new OperationLogger();
// appAuditLogger satisfies OpsLogger (record API) for the P1E consent-UI handlers.
const opsLogger = appAuditLogger;
const fileAccessSvc = new FileAccessService({ http: chatHttp, bookmarks });
const commandPolicy = new CommandPolicy({ bookmarks, serverSettings: fileAccessSvc.getEffectiveSettings() });
fileAccessSvc.onChanged((s) => commandPolicy.updateServerSettings(s));

const agentSvc = new AgentService({ http: chatHttp });
const dialogSvc = new DialogService({ http: chatHttp, getGateway: () => gateway });
const discoverySvc = new DiscoveryService({ http: chatHttp });
const taskSvc = new TaskService({ http: chatHttp });
const auditSvc = new AuditService({ http: chatHttp });

void new AgentEventBus({ dispatcher: pushDispatcher, events });
// P3C-agent-exec-protocol: route node.invoke.request push events to
// command handlers. `gateway` is mutable (constructed inside ConnectionManager.connect), so
// pass an adapter that defers to the current instance at send time.
const blobClient = {
  async upload(data: Buffer): Promise<{ blobId: string } | null> {
    if (!currentBlobEndpoint) return null;
    return new BlobClient(currentBlobEndpoint).upload(data);
  },
  async download(blobId: string): Promise<Buffer | null> {
    if (!currentBlobEndpoint) return null;
    return new BlobClient(currentBlobEndpoint).download(blobId);
  },
};
void new NodeEventHandler({
  dispatcher: pushDispatcher,
  channel: {
    sendRequest: (method, params) => {
      if (!gateway) throw new Error('gateway not connected');
      // `node.invoke.result` needs a different envelope shape than
      // `GatewayChannel.sendRequest` produces — Swift sends it as a
      // server-proxied envelope (`{type, data}`) with required `nodeId`
      // and `ok` fields, NOT the JSON-RPC-style `{type:'request',
      // method, params}`. The server's handler silently drops results
      // that lack `nodeId`, which was causing every file op to time
      // out at the gateway after 30s. Use the helper to rebuild the
      // envelope; route the rest through the legacy path so other
      // request methods still work.
      if (method === 'node.invoke.result') {
        const invokeId = String(params.id ?? '');
        const resultJSON = String(params.result ?? '');
        const envelope = buildNodeInvokeResultEnvelope({
          invokeId,
          nodeId: deviceIdentity.get(),
          resultJSON,
        });
        gateway.sendEnvelope(envelope);
        void log.info('node.invoke.result sent', {
          invokeId,
          ok: envelope.data.ok,
          payloadPreview: resultJSON.slice(0, 200),
        });
        return;
      }
      gateway.sendRequest(method, params);
    },
  },
  policy: commandPolicy,
  fileAccess: fileAccessSvc,
  bookmarks,
  getBlobEndpoint: () => currentBlobEndpoint,
  logger: operationLogger,
  getCurrentSessionId: () => chatSvc.getCurrentSessionId(),
  commands: {
    'file.search': makeFileSearchHandler({ policy: commandPolicy, blobClient }),
    'file.trash': makeFileTrashHandler({ policy: commandPolicy, fileAccess: fileAccessSvc, bookmarks }),
    'file.stat': makeFileStatHandler({ policy: commandPolicy }),
    'file.mkdir': makeFileMkdirHandler({ policy: commandPolicy }),
    'file.rename': makeFileRenameHandler({ policy: commandPolicy }),
    'file.move': makeFileMoveHandler({ policy: commandPolicy }),
    'file.copy': makeFileCopyHandler({ policy: commandPolicy }),
    'file.list': makeFileListHandler({ policy: commandPolicy }),
    'file.write': makeFileWriteHandler({ policy: commandPolicy, blobClient }),
    'file.read': makeFileReadHandler({ policy: commandPolicy, blobClient }),
    'ops.log': makeOpsLogHandler({
      logger: operationLogger,
      fileAccess: fileAccessSvc,
      getCurrentSessionId: () => chatSvc.getCurrentSessionId(),
      bookmarks,
    }),
    'ops.undo': makeOpsUndoHandler({
      logger: operationLogger,
      undoExecutor: executeReverseAction,
      fileAccess: fileAccessSvc,
      getCurrentSessionId: () => chatSvc.getCurrentSessionId(),
      bookmarks,
    }),
    'ops.rollback': makeOpsRollbackHandler({
      logger: operationLogger,
      undoExecutor: executeReverseAction,
      fileAccess: fileAccessSvc,
      getCurrentSessionId: () => chatSvc.getCurrentSessionId(),
      bookmarks,
    }),
  },
});

registerAgentsHandlers(router, {
  agents: agentSvc, dialogs: dialogSvc, discovery: discoverySvc, tasks: taskSvc,
});
registerAuditHandlers(router, auditSvc);
registerFileAccessHandlers(router, fileAccessSvc);

// P2C: contacts + friend requests.
const contactSvc = new ContactService({ http: chatHttp });
registerContactsHandlers(router, contactSvc);

// P3A: tags + node ACL.
const tagSvc = new TagService({ http: chatHttp });
registerTagsHandlers(router, tagSvc);

// P3B: user profile + language sync.
const profileSvc = new ProfileService({ http: chatHttp });
registerProfileHandlers(router, profileSvc);

// (NotificationService is constructed earlier and wired into
// ChatEventHandler — see the `notifier` binding above. The round-6
// G3 fix replaced the previous "instantiate-but-ignore" skeleton.)

// P3F: auto-update. Skipped in test/CI via env var so e2e doesn't probe GitHub.
const updateSvc = new UpdateService({ updater: autoUpdater });
registerUpdateHandlers(router, events, updateSvc);

// P2F: top-level file search.
registerFilesHandlers(router, fileSvc);

// Generic shell ops (open cached download in OS default app, etc.).
registerShellHandlers(router);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

void app.whenReady().then(async () => {
  installProtocolBridge({
    serverURL: () => auth.baseURL(),
    getAccessToken: async () => auth.getAccessToken(),
    refreshIfNeeded: async () => { await auth.refreshAccessToken(); },
  });
  await creds.load().catch((e) => { void log.warn('credentials load failed', { error: String(e) }); });
  await bookmarks.load().catch(() => { /* missing file is OK */ });
  // Best-effort initial sync of server file-access policy. Failure is non-fatal.
  void fileAccessSvc.syncFromServer().catch(() => { /* continue with null cached */ });
  await networkMonitor.start();
  void authSvc.restoreSession();
  void createMainWindow(AppPaths.userData());
  {
    const fileAccessSettings = fileAccessSvc.getEffectiveSettings();
    if (fileAccessSettings?.allowedPaths) {
      for (const root of fileAccessSettings.allowedPaths) {
        if (root.includes('*') || root.includes('?')) continue;
        void pruneOldLogs(root, 90).catch(() => undefined);
      }
    }
  }
  if (process.env.CLAWNET_DISABLE_AUTO_UPDATE !== '1') {
    updateSvc.start();
    // Delay 5s so the first auto-check doesn't block first paint.
    setTimeout(() => { void updateSvc.checkForUpdates(); }, 5000);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow(AppPaths.userData());
  });
});

app.on('before-quit', () => {
  router.dispose();
  networkMonitor.stop();
  playbackEngine.shutdown();
  {
    const fileAccessSettings = fileAccessSvc.getEffectiveSettings();
    if (fileAccessSettings?.allowedPaths) {
      for (const root of fileAccessSettings.allowedPaths) {
        if (root.includes('*') || root.includes('?')) continue;
        void pruneOldLogs(root, 90).catch(() => undefined);
      }
    }
  }
});

function httpToWs(url: string): string {
  if (url.startsWith('https://')) return 'wss://' + url.slice(8);
  if (url.startsWith('http://')) return 'ws://' + url.slice(7);
  return url;
}
