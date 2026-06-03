// e2e/fixtures/fake-server.ts
//
// In-process fake of the ClawNet REST + WS surface. Tests start a fresh server
// per scenario; the launcher gets the URL via CLAWNET_E2E_SERVER_URL so the
// renderer's Login form is pre-filled.
import express, { type RequestHandler } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import {
  LOGIN_RESPONSE,
  CONVERSATIONS_RESPONSE,
  MESSAGES_RESPONSE,
  FILE_ACCESS_SETTINGS_RESPONSE,
  CONTACTS_RESPONSE,
  CONTACT_SEARCH_RESULTS,
  FRIEND_REQUESTS_RESPONSE,
  GROUP_CONVERSATION_SEED,
  SEARCH_MESSAGES_RESPONSE,
  SEARCH_FILES_RESPONSE,
} from './responses';
import { HELLO_OK_FRAME } from './stream-script';

export interface FakeServer {
  url: string;
  wsUrl: string;
  port: number;
  close: () => Promise<void>;
  pushTimeline: (
    sockets: WebSocket[],
    timeline: Array<{ delayMs: number; frame: unknown }>,
  ) => Promise<void>;
  getActiveSockets: () => WebSocket[];
  /**
   * Seed an in-memory blob so a file.write invoke can download it.
   * `content` is a UTF-8 string by default; pass `encoding:'base64'` for
   * binary payloads.
   */
  seedBlob: (p: { blobId: string; content: string; encoding?: string }) => Promise<void>;
  /**
   * Fetch a blob that was uploaded by a file.read invoke (or seeded via
   * seedBlob) and return its raw bytes.
   */
  fetchBlob: (blobId: string) => Promise<Buffer>;
  /**
   * Push a `chat.message.created` WS frame to all connected clients.
   * The payload is sent as snake_case on the wire; the main-process
   * ChatEventHandler normalises it to camelCase before storing in SQLite.
   *
   * Payload shape mirrors the server wire format:
   *   { id, conversation_id, sender:{id,name,type}, content_type, content, timestamp }
   */
  pushChatMessage: (payload: {
    id: string;
    conversation_id: string;
    sender: { id: string; name: string; type: string };
    content_type: string;
    content: Record<string, unknown>;
    timestamp: string;
  }) => Promise<void>;
  /**
   * Test helpers for Batch E (image/file inline rendering + Open via cache).
   * Pre-seed a file in the server's file store so the renderer's
   * `clawnet-file://{id}` protocol bridge OR `chat.fetchFileForOpen` can
   * download it without needing a prior upload round-trip.
   */
  seedImage: (fileId: string, bytes: Buffer, mime?: string) => void;
  seedFile: (fileId: string, bytes: Buffer, mime?: string, name?: string) => void;
  /**
   * Push a `chat.message.created` WS frame for an image attachment that
   * references a previously-seeded file id. The conversation id can match
   * any existing seeded conversation (e.g. `c-agent`) — the renderer's
   * ChatEventHandler upserts the message regardless and the existing
   * conversation list refresh kicks in.
   */
  pushIncomingImage: (p: {
    conversationId: string;
    fileId: string;
    name?: string;
    size?: number;
    mimeType?: string;
    sender?: { id: string; name: string; type: string };
  }) => Promise<void>;
  pushIncomingFile: (p: {
    conversationId: string;
    fileId: string;
    name?: string;
    size?: number;
    mimeType?: string;
    sender?: { id: string; name: string; type: string };
  }) => Promise<void>;
}

export interface FakeServerOptions {
  /**
   * Optional Express-style route overrides keyed as `"METHOD /path"`. Override
   * handlers run before the default handlers, so tests can simulate flaky
   * routes (401-once, slow paths, etc.). Path string is matched exactly.
   */
  overrides?: Record<string, RequestHandler>;
}

export async function startFakeServer(opts: FakeServerOptions = {}): Promise<FakeServer> {
  const app = express();
  app.use(express.json());

  // --- Optional per-route overrides (run before defaults) ---
  if (opts.overrides) {
    for (const [key, handler] of Object.entries(opts.overrides)) {
      const space = key.indexOf(' ');
      if (space < 0) throw new Error(`Invalid override key "${key}", expected "METHOD /path"`);
      const method = key.slice(0, space).toLowerCase() as
        | 'get'
        | 'post'
        | 'put'
        | 'patch'
        | 'delete';
      const path = key.slice(space + 1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (app as any)[method](path, handler);
    }
  }

  // --- REST endpoints ---
  app.post('/api/v1/auth/login', (_req, res) => {
    res.json(LOGIN_RESPONSE);
  });
  app.post('/api/v1/auth/refresh', (_req, res) => {
    res.json({
      data: {
        access_token: LOGIN_RESPONSE.data.tokens.access_token,
        refresh_token: 'rt-rotated',
      },
    });
  });
  app.post('/api/v1/auth/logout', (_req, res) => {
    res.json({});
  });

  // --- P3B: profile (/me) + change password + server-language sync ---
  // Single source of truth for the "current user" within this server
  // instance. Initial values mirror LOGIN_RESPONSE so GET /me agrees
  // with whatever the login flow already populated in the auth store.
  // PATCH /me merges the request body shallowly; the HttpClient REST
  // boundary converts outgoing camelCase keys to snake_case, so request
  // bodies arrive here as snake_case (display_name, avatar_url, etc.).
  const meState: {
    id: string;
    display_name: string;
    avatar_url: string | null;
    email: string;
    user_code: string;
    phone: string | null;
    status: string;
  } = {
    id: LOGIN_RESPONSE.data.user.id,
    display_name: LOGIN_RESPONSE.data.user.display_name,
    avatar_url: null,
    email: LOGIN_RESPONSE.data.user.email,
    user_code: LOGIN_RESPONSE.data.user.user_code,
    phone: null,
    status: 'online',
  };
  let serverLanguage: 'en' | 'zh-Hans' = 'en';
  // ChangePasswordSheet's first-fill value in the spec; the fake-server
  // accepts whatever the test provides as "current" and rotates it.
  let serverPassword = 'tempPass1';

  app.get('/api/v1/users/me', (_req, res) => {
    res.json({ data: meState });
  });
  app.patch('/api/v1/users/me', (req, res) => {
    const body = req.body as Partial<typeof meState>;
    if (body.display_name !== undefined) meState.display_name = body.display_name;
    if (body.email !== undefined) meState.email = body.email;
    if (body.avatar_url !== undefined) meState.avatar_url = body.avatar_url;
    if (body.phone !== undefined) meState.phone = body.phone;
    res.json({ data: meState });
  });
  app.put('/api/v1/users/me/language', (req, res) => {
    serverLanguage = (req.body as { language: 'en' | 'zh-Hans' }).language;
    void serverLanguage; // observable via close-over; not read by spec
    res.status(204).end();
  });
  app.patch('/api/v1/auth/password', (req, res) => {
    const body = req.body as { old_password: string; new_password: string };
    if (body.old_password !== serverPassword) {
      return res.status(400).json({ error: 'invalid_password' });
    }
    serverPassword = body.new_password;
    return res.json({ success: true });
  });

  // --- P2D: in-memory group conversation store ---
  // Tests share this across handlers so createGroup → list → getMembers →
  // addMembers → removeMember → updateConversation round-trip end-to-end.
  type GroupConvo = typeof GROUP_CONVERSATION_SEED & { summary?: string | null };
  const groupStore = new Map<string, GroupConvo>();
  const cloneGroup = (g: typeof GROUP_CONVERSATION_SEED): GroupConvo =>
    JSON.parse(JSON.stringify(g)) as GroupConvo;
  groupStore.set(GROUP_CONVERSATION_SEED.id, cloneGroup(GROUP_CONVERSATION_SEED));

  app.get('/api/v1/conversations', (_req, res) => {
    res.json({
      data: [...CONVERSATIONS_RESPONSE.data, ...Array.from(groupStore.values())],
    });
  });
  app.get('/api/v1/conversations/:id', (req, res) => {
    const direct = CONVERSATIONS_RESPONSE.data.find((c) => c.id === req.params.id);
    if (direct) return res.json({ data: direct });
    const group = groupStore.get(req.params.id);
    if (group) return res.json({ data: group });
    return res.status(404).json({ error: 'not_found' });
  });
  app.get('/api/v1/conversations/:id/messages', (_req, res) => {
    res.json(MESSAGES_RESPONSE);
  });
  app.post('/api/v1/conversations/:id/messages', (req, res) => {
    const body = req.body as { content_type?: string; content?: unknown };
    res.json({
      data: {
        id: `m-user-${Date.now()}`,
        conversation_id: req.params.id,
        sender: { id: 'u-e2e', name: 'E2E User', type: 'human' },
        content_type: body.content_type ?? 'text',
        content: body.content ?? { text: '' },
        timestamp: new Date().toISOString(),
        status: 'sent',
      },
    });
  });
  app.post('/api/v1/conversations/:id/read', (_req, res) => {
    res.json({});
  });

  const agentStore = new Map<string, Record<string, unknown>>();

  app.get('/api/v1/agents', (_req, res) => {
    res.json({ data: Array.from(agentStore.values()) });
  });
  app.get('/api/v1/agents/contactable', (_req, res) => {
    res.json({ data: [] });
  });
  app.get('/api/v1/agents/:id', (req, res) => {
    const a = agentStore.get(req.params.id);
    if (!a) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ data: a });
  });
  app.post('/api/v1/agents', (req, res) => {
    const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const body = req.body as Record<string, unknown>;
    const created = {
      id,
      display_name: body.display_name ?? 'Untitled',
      agent_type: body.agent_type ?? 'general',
      status: 'online',
      execution_mode: body.execution_mode ?? 'hybrid',
      capabilities: body.capabilities ?? [],
      description: body.description ?? null,
      avatar_url: body.avatar_url ?? null,
      system_prompt: body.system_prompt ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    agentStore.set(id, created);
    res.json({ data: created });
  });
  app.patch('/api/v1/agents/:id', (req, res) => {
    const cur = agentStore.get(req.params.id);
    if (!cur) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const next = { ...cur, ...(req.body as Record<string, unknown>), updated_at: new Date().toISOString() };
    agentStore.set(req.params.id, next);
    res.json({ data: next });
  });
  app.delete('/api/v1/agents/:id', (req, res) => {
    agentStore.delete(req.params.id);
    res.sendStatus(204);
  });

  app.get('/api/v1/agent-dialogs', (_req, res) => {
    res.json({ data: [] });
  });
  app.get('/api/v1/agent-dialogs/by-conversation/:id', (_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  app.get('/api/v1/discovery-tasks', (_req, res) => {
    res.json({ data: [] });
  });
  app.get('/api/v1/discovery-tasks/by-conversation/:id', (_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  app.get('/api/v1/file-access/settings', (_req, res) => {
    res.json(FILE_ACCESS_SETTINGS_RESPONSE);
  });
  app.put('/api/v1/file-access/settings', (_req, res) => {
    res.json(FILE_ACCESS_SETTINGS_RESPONSE);
  });

  // --- P3C: audit events (REST list + WS push helper) ---
  // Wire shape matches the macOS server: each event has snake_case keys
  // (id, operation_type, agent_id, operation_details, timestamp). The main
  // process HttpClient converts the response to camelCase, but
  // operation_details values stay snake_case under caseSkipKeys, so seed
  // payloads here mirror the on-the-wire shape.
  type FakeAuditEvent = {
    id: string;
    operation_type: string;
    agent_id?: string;
    operation_details?: Record<string, unknown>;
    timestamp: string;
  };
  const auditEvents: FakeAuditEvent[] = [];

  app.get('/api/v1/audit/events', (req, res) => {
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    res.json({
      status: 'ok',
      data: auditEvents.slice(offset, offset + limit),
    });
  });

  // Test-only: push an `audit.event` WS frame to all connected clients.
  // The renderer's AgentEventBus relays it through AuditEventSchema (camelCase
  // keys), so the request body must already be in the renderer-side shape:
  //   { id, eventType, agentId?, agentName?, tagRole?, details, timestamp }
  // The handler is registered before the WS server is created, so it
  // captures `activeSockets` via the closure assigned below.
  let pushAuditFn: ((payload: unknown) => void) | null = null;
  app.post('/__test/push-audit', (req, res) => {
    pushAuditFn?.(req.body);
    res.status(204).end();
  });

  // --- P3C-agent-exec-protocol: test-only WS push + receive inspection ---
  //
  // `POST /__test/push-node-invoke` mirrors `push-audit`: it broadcasts a
  // `{type:'push', topic:'node.invoke.request', payload}` frame so the
  // main-process PushDispatcher routes it to NodeEventHandler, which then
  // writes back a `{type:'request', method:'node.invoke.result', params}`
  // frame on the same socket.
  //
  // The handler is wired here against `pushNodeInvokeFn`, which the late
  // WS bootstrap below assigns. `receivedFrames` captures every JSON frame
  // the client sends so the spec can assert the `node.invoke.result`
  // round-tripped back.
  let pushNodeInvokeFn: ((payload: unknown) => void) | null = null;
  const receivedFrames: unknown[] = [];
  app.post('/__test/push-node-invoke', (req, res) => {
    pushNodeInvokeFn?.(req.body);
    res.status(204).end();
  });
  app.get('/__test/received-frames', (_req, res) => {
    res.json(receivedFrames);
  });

  // --- P3E: chat.message.created WS push helper ---
  // Broadcasts a `{type:'push', topic:'chat.message.created', payload}` frame
  // so the main-process ChatEventHandler stores the message in SQLite. The
  // payload uses server snake_case keys (conversation_id, content_type) which
  // ChatEventHandler normalises to camelCase before calling store.upsertMessage.
  let pushChatMessageFn: ((payload: unknown) => void) | null = null;
  app.post('/__test/push-chat-message', (req, res) => {
    pushChatMessageFn?.(req.body);
    res.status(204).end();
  });

  // --- P3A: tags CRUD ---
  // In-memory tag store scoped to this server instance (reset per spec via
  // startFakeServer in beforeEach). The HttpClient REST boundary converts
  // outgoing camelCase keys to snake_case, so request bodies arrive here as
  // snake_case (display_name, node_acl) — and snake_case payloads we return
  // are converted back to camelCase before TagSchema parses them.
  type FakeTag = {
    id: string;
    owner_id: string;
    name: string;
    display_name: string;
    icon: string | null;
    color: string | null;
    is_default: boolean;
    is_main: boolean | null;
    workspace_id: string;
    node_acl: { allowed_paths: string[]; denied_paths: string[] };
    created_at: string;
    updated_at: string;
  };
  let tags: FakeTag[] = [];
  let tagSeq = 0;

  app.get('/api/v1/tags', (_req, res) => {
    res.json({ data: tags });
  });
  app.post('/api/v1/tags', (req, res) => {
    tagSeq += 1;
    const id = `tag-${tagSeq}`;
    const body = req.body as {
      display_name?: string;
      icon?: string | null;
      color?: string | null;
      node_acl?: { allowed_paths?: string[]; denied_paths?: string[] };
    };
    const created: FakeTag = {
      id,
      owner_id: 'u-e2e',
      name: String(body.display_name ?? '').toLowerCase().replace(/\s+/g, '-'),
      display_name: body.display_name ?? '',
      icon: body.icon ?? null,
      color: body.color ?? null,
      is_default: false,
      is_main: false,
      workspace_id: 'ws-1',
      node_acl: {
        allowed_paths: body.node_acl?.allowed_paths ?? [],
        denied_paths: body.node_acl?.denied_paths ?? [],
      },
      created_at: '2026-05-12T00:00:00Z',
      updated_at: '2026-05-12T00:00:00Z',
    };
    tags.push(created);
    res.json({ data: created });
  });
  app.patch('/api/v1/tags/:id', (req, res) => {
    const t = tags.find((x) => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: 'not_found' });
    const body = req.body as {
      display_name?: string;
      icon?: string | null;
      color?: string | null;
      node_acl?: { allowed_paths?: string[]; denied_paths?: string[] };
    };
    if (body.display_name !== undefined) t.display_name = body.display_name;
    if (body.icon !== undefined) t.icon = body.icon;
    if (body.color !== undefined) t.color = body.color;
    if (body.node_acl !== undefined) {
      t.node_acl = {
        allowed_paths: body.node_acl.allowed_paths ?? [],
        denied_paths: body.node_acl.denied_paths ?? [],
      };
    }
    t.updated_at = '2026-05-12T00:00:01Z';
    return res.json({ data: t });
  });
  app.delete('/api/v1/tags/:id', (req, res) => {
    tags = tags.filter((x) => x.id !== req.params.id);
    res.sendStatus(204);
  });

  // --- P2C: contacts + friend requests ---
  app.get('/api/v1/contacts', (_req, res) => {
    res.json(CONTACTS_RESPONSE);
  });
  app.get('/api/v1/search/contacts', (_req, res) => {
    res.json(CONTACT_SEARCH_RESULTS);
  });
  // -- P2F: messages + files search.
  app.get('/api/v1/search/messages', (_req, res) => {
    res.json(SEARCH_MESSAGES_RESPONSE);
  });
  app.get('/api/v1/search/files', (_req, res) => {
    res.json(SEARCH_FILES_RESPONSE);
  });
  app.post('/api/v1/contacts', (req, res) => {
    res.json({
      data: {
        id: req.body.contact_id,
        display_name: 'Just Added',
        type: req.body.contact_type ?? 'human',
      },
    });
  });
  app.delete('/api/v1/contacts/:id', (_req, res) => {
    res.sendStatus(204);
  });

  app.get('/api/v1/friend-requests/pending', (_req, res) => {
    res.json(FRIEND_REQUESTS_RESPONSE);
  });
  app.post('/api/v1/friend-requests', (req, res) => {
    res.json({
      data: {
        id: 'fr-new',
        from_user_id: 'u-e2e', from_user_name: 'E2E User',
        to_user_id: req.body.to_user_id, to_user_name: 'Bob Test',
        status: 'pending',
        created_at: new Date().toISOString(),
      },
    });
  });
  app.post('/api/v1/friend-requests/:id/accept', (_req, res) => {
    res.json({});
  });
  app.post('/api/v1/friend-requests/:id/reject', (_req, res) => {
    res.json({});
  });

  // POST /api/v1/conversations — used by both chat.createDirectConversation
  // (P2C "Send message" on a contact) and chat.createGroup (P2D). The wire
  // type field discriminates; for groups we seed the in-memory group store
  // with the owner + invitees so subsequent member ops work end-to-end.
  const nameForId = (id: string): string => {
    if (id === 'u-other-1') return 'Alice E2E';
    if (id === 'u-other-2') return 'Bob E2E';
    return id;
  };
  app.post('/api/v1/conversations', (req, res) => {
    const ids: string[] = (req.body.participant_ids as string[]) ?? [];
    const type = (req.body.type as string | undefined) ?? 'direct';
    if (type === 'group') {
      const id = `c-group-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const created: GroupConvo = {
        id,
        type: 'group',
        title: (req.body.title as string | undefined) ?? null as unknown as string,
        participants: [
          { id: 'u-e2e', name: 'E2E User', type: 'human', role: 'owner' },
          ...ids.map((pid) => ({
            id: pid,
            name: nameForId(pid),
            type: 'human' as const,
            role: 'member' as const,
          })),
        ],
        unread_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      groupStore.set(id, created);
      return res.json({ data: created });
    }
    // direct conversation (P2C path)
    return res.json({
      data: {
        id: `c-direct-${Date.now()}`,
        type,
        participants: ids.map((pid) => ({
          id: pid,
          name: nameForId(pid),
          type: 'human',
        })),
        unread_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
  });

  // --- P2D: group member ops + conversation update ---
  app.get('/api/v1/conversations/:id/members', (req, res) => {
    const g = groupStore.get(req.params.id);
    if (!g) return res.sendStatus(404);
    return res.json({ data: g.participants });
  });

  app.post('/api/v1/conversations/:id/members', (req, res) => {
    const g = groupStore.get(req.params.id);
    if (!g) return res.sendStatus(404);
    const newIds: string[] = (req.body.participant_ids as string[]) ?? [];
    const added = newIds.map((pid) => ({
      id: pid,
      name: nameForId(pid),
      type: 'human' as const,
      role: 'member' as const,
    }));
    g.participants = [...g.participants, ...added];
    g.updated_at = new Date().toISOString();
    return res.json({ data: added });
  });

  app.delete('/api/v1/conversations/:id/members/:memberId', (req, res) => {
    const g = groupStore.get(req.params.id);
    if (!g) return res.sendStatus(404);
    g.participants = g.participants.filter((p) => p.id !== req.params.memberId);
    g.updated_at = new Date().toISOString();
    return res.sendStatus(204);
  });

  app.patch('/api/v1/conversations/:id', (req, res) => {
    const g = groupStore.get(req.params.id);
    if (!g) return res.sendStatus(404);
    if (req.body.title !== undefined) g.title = req.body.title;
    if (req.body.summary !== undefined) g.summary = req.body.summary;
    g.updated_at = new Date().toISOString();
    return res.json({ data: g });
  });

  // --- P2A: file upload/download endpoints ---
  //
  // The real server runs a chunked-upload pipeline; for e2e we only need to
  // simulate the surface contract (HEAD/POST chunk/POST complete/GET info/
  // GET download) and round-trip the content bytes. The fake store is keyed
  // by hash → record so checkFile can find prior uploads (dedupe path).
  type FileRecord = {
    id: string;
    name: string;
    size: number;
    mime: string;
    data: Buffer;
  };
  const fileStoreByHash = new Map<string, FileRecord>();
  const fileStoreById = new Map<string, FileRecord>();
  const pendingChunks = new Map<string, Buffer>();

  app.head('/api/v1/files/check/:hash', (req, res) => {
    const existing = fileStoreByHash.get(req.params.hash);
    if (existing) {
      res.setHeader('X-File-Id', existing.id);
      return res.sendStatus(200);
    }
    return res.sendStatus(404);
  });

  // The multipart parser only needs to extract the actual file bytes from
  // between the boundary markers. We accept the request body as raw bytes
  // and slice out the payload between the two CRLF delimiters surrounding
  // the binary content.
  //
  // Batch E: the chat.service now chunks 256KB at a time, so a single upload
  // may invoke this route multiple times for the same hash with different
  // `?chunk_index=N`. We append each chunk to the in-memory buffer rather
  // than overwriting so `completeUpload` sees the full file.
  app.post(
    '/api/v1/files/upload/:hash/chunk',
    express.raw({ type: 'multipart/form-data', limit: '50mb' }),
    (req, res) => {
      const raw = req.body as Buffer;
      // Find the empty line that separates the part headers from the body.
      const headEnd = raw.indexOf(Buffer.from('\r\n\r\n'));
      if (headEnd < 0) return res.status(400).json({ error: 'bad_multipart' });
      // The trailing `\r\n--<boundary>--\r\n` closes the body. Strip it.
      // Locate the last CRLF + double-dash sequence by searching back.
      const tailIdx = raw.lastIndexOf(Buffer.from('\r\n--'));
      if (tailIdx < 0) return res.status(400).json({ error: 'bad_multipart' });
      const payload = raw.subarray(headEnd + 4, tailIdx);
      const prior = pendingChunks.get(req.params.hash) ?? Buffer.alloc(0);
      pendingChunks.set(req.params.hash, Buffer.concat([prior, Buffer.from(payload)]));
      return res.json({ status: 'ok' });
    },
  );

  app.post('/api/v1/files/upload/:hash/complete', (req, res) => {
    const body = req.body as { hash: string; name: string; size: number; mime_type: string };
    const chunk = pendingChunks.get(req.params.hash) ?? Buffer.alloc(0);
    pendingChunks.delete(req.params.hash);
    const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const record: FileRecord = {
      id,
      name: body.name,
      size: body.size,
      mime: body.mime_type,
      data: chunk,
    };
    fileStoreByHash.set(req.params.hash, record);
    fileStoreById.set(id, record);
    return res.json({
      data: {
        id,
        name: body.name,
        size: body.size,
        mime_type: body.mime_type,
        url: `/api/v1/files/${id}/download`,
      },
    });
  });

  app.get('/api/v1/files/:id', (req, res) => {
    const f = fileStoreById.get(req.params.id);
    if (!f) return res.sendStatus(404);
    return res.json({
      data: {
        id: f.id,
        name: f.name,
        size: f.size,
        mime_type: f.mime,
        url: `/api/v1/files/${f.id}/download`,
      },
    });
  });

  // Batch E: spec 47 needs an out-of-band way to assert that the renderer
  // actually issued the streaming download (the visible UI state depends on
  // shell.openPath returning, which is host-dependent on Linux CI). Tally
  // each successful download per fileId so the spec can poll.
  const downloadCount = new Map<string, number>();
  app.get('/__test/download-count/:id', (req, res) => {
    res.json({ count: downloadCount.get(req.params.id) ?? 0 });
  });

  app.get('/api/v1/files/:id/download', (req, res) => {
    const f = fileStoreById.get(req.params.id);
    if (!f) return res.sendStatus(404);
    res.setHeader('Content-Type', f.mime);
    // Batch E: the renderer's streaming download reads `content-length` to
    // size its progress bar. Express's res.send sets it automatically for
    // Buffer bodies, but we set it explicitly so the header is visible even
    // when proxy middleware would otherwise drop it.
    res.setHeader('Content-Length', String(f.data.byteLength));
    downloadCount.set(req.params.id, (downloadCount.get(req.params.id) ?? 0) + 1);
    return res.send(f.data);
  });

  // --- Batch E: test-only seeding for image/file inline rendering specs ---
  //
  // These routes let specs pre-load files into the server store WITHOUT going
  // through the upload pipeline first. The clawnet-file:// protocol bridge
  // then sees them via GET /api/v1/files/:id/download; chat.fetchFileForOpen
  // streams them the same way. Body shape: { id, base64, mime?, name? }.
  app.post('/__test/seed-file', (req, res) => {
    const body = req.body as {
      id: string;
      base64: string;
      mime?: string;
      name?: string;
    };
    const data = Buffer.from(body.base64, 'base64');
    const record: FileRecord = {
      id: body.id,
      name: body.name ?? 'file',
      size: data.byteLength,
      mime: body.mime ?? 'application/octet-stream',
      data,
    };
    fileStoreById.set(body.id, record);
    res.status(204).end();
  });

  // --- P3C-agent-exec-NodeEvent: blob store for file.read / file.write ---
  //
  // BlobClient derives the endpoint URL by converting the WS URL to HTTP and
  // appending /blobs via joinURL. After the 2026-05-13 server-proxied WS
  // refactor (commit 58134b0), the renderer connects on /ws/v1/messages, so
  // the blob endpoint resolves to /ws/v1/messages/blobs. We mount BOTH the
  // new path and the legacy /api/v1/ws/blobs alias so any caller that still
  // remembers the old endpoint keeps working.
  const blobStore = new Map<string, Buffer>();

  const handleBlobUpload: RequestHandler = (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const blobId = 'b' + Math.random().toString(36).slice(2, 10);
      blobStore.set(blobId, body);
      res.status(201).json({ blobId });
    });
  };
  const handleBlobDownload: RequestHandler = (req, res) => {
    const id = req.params.id;
    if (typeof id !== 'string') { res.status(400).end(); return; }
    const buf = blobStore.get(id);
    if (!buf) { res.status(404).end(); return; }
    res.status(200).type('application/octet-stream').send(buf);
  };

  app.post('/ws/v1/messages/blobs', handleBlobUpload);
  app.get('/ws/v1/messages/blobs/:id', handleBlobDownload);
  app.post('/api/v1/ws/blobs', handleBlobUpload);
  app.get('/api/v1/ws/blobs/:id', handleBlobDownload);

  // Test helper: pre-seed a blob so file.write invokes can reference it.
  app.post('/__test/seed-blob', (req, res) => {
    const { blobId, content, encoding } = req.body as {
      blobId: string;
      content: string;
      encoding?: string;
    };
    blobStore.set(blobId, Buffer.from(content, encoding === 'base64' ? 'base64' : 'utf-8'));
    res.status(200).end();
  });

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}`;

  // --- WS endpoint ---
  // Renderer connects to `/ws/v1/messages?token=...` (server-proxied flow,
  // matches macOS ServerConnection.swift:27-38). The legacy `/api/v1/ws`
  // paired-device path has been removed from the renderer side, so we no
  // longer mount it here. The server-proxied flow:
  //   1. accepts the WS on `/ws/v1/messages` with token in query string
  //   2. pushes `{type:'auth_success'}` instead of waiting for a hello
  //   3. handles ping fire-and-forget (no pong required by renderer)
  // Pushed PushFrame envelopes (`{type:'push', topic, payload}`) still work
  // because GatewayChannel parses both legacy `push` and the new
  // server-proxied open envelopes — old push helpers below don't need to
  // change.
  const wss = new WebSocketServer({ server, path: '/ws/v1/messages' });
  const activeSockets: WebSocket[] = [];
  // Token → socket map so tests can target push frames at a specific
  // logged-in user. Populated on connection (parse token from URL),
  // cleared on close.
  const socketByToken = new Map<string, WebSocket>();
  wss.on('connection', (socket, req) => {
    activeSockets.push(socket);
    // Parse the `?token=` query string. The client puts the access token
    // there per macOS ServerConnection.swift:30. We don't validate; we
    // just use the token string as a routing key for per-user pushes.
    const reqUrl = req.url ?? '';
    const tokenMatch = /[?&]token=([^&]+)/.exec(reqUrl);
    const token = tokenMatch ? decodeURIComponent(tokenMatch[1]!) : '';
    if (token) socketByToken.set(token, socket);
    // Per server-proxied flow: send auth_success immediately on connection.
    // The token in the query string is treated as valid (fake-server doesn't
    // verify it — tests only need the connection to come up).
    socket.send(JSON.stringify({ type: 'auth_success' }));
    // P3C-agent-exec-protocol: capture every JSON frame the client sends so
    // tests can inspect the outbound side (e.g. assert that
    // `node.invoke.result` rounds back after a `node.invoke.request` push).
    socket.on('message', (data: Buffer) => {
      try {
        receivedFrames.push(JSON.parse(data.toString()));
      } catch {
        /* non-JSON frame — ignore */
      }
    });
    socket.on('message', (data) => {
      const text = data.toString();
      let frame: { type?: string };
      try {
        frame = JSON.parse(text) as { type?: string };
      } catch {
        return;
      }
      // Some specs still send a hello frame for compatibility — accept it
      // silently. Ping is fire-and-forget per the server-proxied flow.
      if (frame.type === 'hello') {
        socket.send(JSON.stringify(HELLO_OK_FRAME));
      }
      // No pong reply — matches macOS ServerConnection.swift:120 behavior.
    });
    socket.on('close', () => {
      const idx = activeSockets.indexOf(socket);
      if (idx >= 0) activeSockets.splice(idx, 1);
      if (token) socketByToken.delete(token);
    });
  });

  // Broadcast push: deliver an arbitrary frame to ALL active sockets.
  // Used by single-instance specs that want to simulate server pushes
  // without caring about which socket receives it (since there's only
  // one). Payload shape: `{ frame: <any JSON> }`.
  app.post('/__test/push-frame', (req, res) => {
    const body = req.body as { frame?: unknown };
    if (body.frame === undefined) {
      res.status(400).json({ error: 'missing frame' });
      return;
    }
    const text = JSON.stringify(body.frame);
    for (const s of activeSockets) {
      if (s.readyState === s.OPEN) s.send(text);
    }
    res.status(204).end();
  });

  // Targeted push: deliver a frame to exactly one logged-in user's WS
  // (looked up by their access token). Used by two-user A2A simulation
  // specs where each side must see its own card without leaking events
  // across sockets.
  app.post('/__test/push-to-token', (req, res) => {
    const body = req.body as { token?: string; frame?: unknown };
    const tok = typeof body.token === 'string' ? body.token : '';
    const sock = tok ? socketByToken.get(tok) : undefined;
    if (sock && sock.readyState === sock.OPEN) {
      sock.send(JSON.stringify(body.frame));
      res.status(204).end();
      return;
    }
    res.status(404).json({ error: 'no socket for token', knownTokens: [...socketByToken.keys()].length });
  });

  // Late-bind the P3C audit push helper — the `/__test/push-audit` route
  // (registered above) needs access to the WS socket pool, which is only
  // created here. Broadcast as a standard PushFrame so the main-process
  // GatewayChannel routes it through AgentEventBus → audit.event IPC.
  pushAuditFn = (payload: unknown): void => {
    const frame = JSON.stringify({ type: 'push', topic: 'audit.event', payload });
    for (const s of activeSockets) {
      if (s.readyState === s.OPEN) s.send(frame);
    }
  };

  // P3C-agent-exec-protocol: late-bind the node.invoke push helper. Same
  // PushFrame envelope as audit — the main-process PushDispatcher routes
  // by topic to NodeEventHandler, which writes a node.invoke.result frame
  // back through GatewayChannel.sendRequest (captured by receivedFrames).
  pushNodeInvokeFn = (payload: unknown): void => {
    const frame = JSON.stringify({ type: 'push', topic: 'node.invoke.request', payload });
    for (const s of activeSockets) {
      if (s.readyState === s.OPEN) s.send(frame);
    }
  };

  // P3E: late-bind the chat.message.created push helper. Broadcasts a
  // standard PushFrame so ChatEventHandler stores the message in SQLite.
  pushChatMessageFn = (payload: unknown): void => {
    const frame = JSON.stringify({ type: 'push', topic: 'chat.message.created', payload });
    for (const s of activeSockets) {
      if (s.readyState === s.OPEN) s.send(frame);
    }
  };

  async function pushTimeline(
    sockets: WebSocket[],
    timeline: Array<{ delayMs: number; frame: unknown }>,
  ): Promise<void> {
    for (const step of timeline) {
      await new Promise((r) => setTimeout(r, step.delayMs));
      for (const s of sockets) {
        if (s.readyState === s.OPEN) s.send(JSON.stringify(step.frame));
      }
    }
  }

  async function seedBlob(p: {
    blobId: string;
    content: string;
    encoding?: string;
  }): Promise<void> {
    await fetch(`${url}/__test/seed-blob`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    });
  }

  async function fetchBlob(blobId: string): Promise<Buffer> {
    const res = await fetch(`${url}/api/v1/ws/blobs/${blobId}`);
    if (res.status !== 200) throw new Error(`fetchBlob failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async function pushChatMessage(payload: {
    id: string;
    conversation_id: string;
    sender: { id: string; name: string; type: string };
    content_type: string;
    content: Record<string, unknown>;
    timestamp: string;
  }): Promise<void> {
    await fetch(`${url}/__test/push-chat-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  // --- Batch E test helpers ---
  //
  // seedImage / seedFile go through the same `/__test/seed-file` REST route
  // (the only difference is the default mime); both make the bytes available
  // for clawnet-file://{id} fetches AND chat.fetchFileForOpen downloads.
  // The bytes are NOT looked up by hash (that's the upload dedupe path) —
  // they're keyed only by the file id the caller chose.
  function seedImage(fileId: string, bytes: Buffer, mime = 'image/png'): void {
    const record: FileRecord = {
      id: fileId,
      name: 'image',
      size: bytes.byteLength,
      mime,
      data: bytes,
    };
    fileStoreById.set(fileId, record);
  }
  function seedFile(
    fileId: string,
    bytes: Buffer,
    mime = 'application/octet-stream',
    name = 'file',
  ): void {
    const record: FileRecord = {
      id: fileId,
      name,
      size: bytes.byteLength,
      mime,
      data: bytes,
    };
    fileStoreById.set(fileId, record);
  }

  // pushIncomingImage / pushIncomingFile build a server-proxied `message.new`
  // PushFrame envelope (the topic ChatEventHandler subscribes to since the
  // 2026-05-13 server-proxied WS refactor; the legacy `chat.message.created`
  // topic that `pushChatMessage` above still uses is no longer wired). The
  // renderer's ChatEventHandler converts snake→camel and stores the message;
  // the bubble then uses content.id to construct clawnet-file://{id}.
  async function pushMessageNew(payload: Record<string, unknown>): Promise<void> {
    await pushTimeline(activeSockets, [
      { delayMs: 0, frame: { type: 'push', topic: 'message.new', payload } },
    ]);
  }
  async function pushIncomingImage(p: {
    conversationId: string;
    fileId: string;
    name?: string;
    size?: number;
    mimeType?: string;
    sender?: { id: string; name: string; type: string };
  }): Promise<void> {
    await pushMessageNew({
      id: `m-${p.fileId}-${Date.now()}`,
      conversation_id: p.conversationId,
      sender: p.sender ?? { id: 'a-helper', name: 'Helper Agent', type: 'agent' },
      content_type: 'image',
      content: {
        id: p.fileId,
        name: p.name ?? 'image.png',
        size: p.size ?? 0,
        mime_type: p.mimeType ?? 'image/png',
      },
      timestamp: new Date().toISOString(),
      status: 'sent',
    });
  }
  async function pushIncomingFile(p: {
    conversationId: string;
    fileId: string;
    name?: string;
    size?: number;
    mimeType?: string;
    sender?: { id: string; name: string; type: string };
  }): Promise<void> {
    await pushMessageNew({
      id: `m-${p.fileId}-${Date.now()}`,
      conversation_id: p.conversationId,
      sender: p.sender ?? { id: 'a-helper', name: 'Helper Agent', type: 'agent' },
      content_type: 'file',
      content: {
        id: p.fileId,
        name: p.name ?? 'file',
        size: p.size ?? 0,
        mime_type: p.mimeType ?? 'application/octet-stream',
      },
      timestamp: new Date().toISOString(),
      status: 'sent',
    });
  }

  return {
    url,
    wsUrl: `ws://127.0.0.1:${port}/api/v1/ws`,
    port,
    close: async () => {
      for (const s of activeSockets) s.terminate();
      wss.close();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
    pushTimeline,
    getActiveSockets: () => activeSockets,
    seedBlob,
    fetchBlob,
    pushChatMessage,
    seedImage,
    seedFile,
    pushIncomingImage,
    pushIncomingFile,
  };
}
