import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatService } from '../chat.service';
import { FileService } from '../../../network/file-service';
import { HttpClient } from '../../../network/http-client';
import { ConversationStore } from '../../../store/conversation-store';

const BASE = 'http://example.test:9010';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

class MemKv {
  private m = new Map<string, unknown>();
  get<T>(k: string) { return this.m.get(k) as T | undefined; }
  set(k: string, v: unknown) { this.m.set(k, v); }
}

let store: ConversationStore;
let http_: HttpClient;
let files: FileService;
let svc: ChatService;

beforeEach(() => {
  store = new ConversationStore(new MemKv());
  http_ = new HttpClient({
    baseURL: BASE,
    getAccessToken: async () => 'tok',
  });
  files = new FileService({
    http: http_,
    baseURL: BASE,
    getAccessToken: async () => 'tok',
  });
  svc = new ChatService({ http: http_, store, files });
});

describe('ChatService.listConversations', () => {
  it('fetches, validates, persists, returns sorted', async () => {
    server.use(
      http.get(`${BASE}/api/v1/conversations`, () => HttpResponse.json({
        data: [
          { id: 'a', type: 'direct', participants: [],
            unreadCount: 0, createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            lastMessageAt: '2026-01-01T00:00:00Z' },
          { id: 'b', type: 'group', participants: [],
            unreadCount: 2, createdAt: '2026-03-01T00:00:00Z',
            updatedAt: '2026-03-01T00:00:00Z',
            lastMessageAt: '2026-03-01T00:00:00Z' },
        ],
      })),
    );
    const out = await svc.listConversations();
    expect(out.map((c) => c.id)).toEqual(['b', 'a']);
    expect(store.listConversations()).toHaveLength(2);
  });
});

describe('ChatService.listMessages', () => {
  it('fetches page of messages with snake_case params', async () => {
    server.use(
      http.get(`${BASE}/api/v1/conversations/c1/messages`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('page')).toBe('1');
        expect(url.searchParams.get('page_size')).toBe('50');
        return HttpResponse.json({
          data: [{
            id: 'm1', conversationId: 'c1',
            sender: { id: 'u1', name: 'A', type: 'human' },
            contentType: 'text', content: { text: 'hi' },
            timestamp: '2026-05-01T00:00:00Z', status: 'sent',
          }],
          meta: { page: 1, pageSize: 50, total: 1, hasMore: false },
        });
      }),
    );
    const out = await svc.listMessages('c1', 1, 50);
    expect(out.messages).toHaveLength(1);
    expect(store.listMessages('c1')).toHaveLength(1);
  });
});

describe('ChatService.sendText', () => {
  it('POSTs content_type=text and inserts returned message', async () => {
    server.use(
      http.post(`${BASE}/api/v1/conversations/c1/messages`, async ({ request }) => {
        const body = await request.json() as { content_type: string; content: { text: string } };
        expect(body.content_type).toBe('text');
        expect(body.content.text).toBe('hello');
        return HttpResponse.json({
          data: {
            id: 'm-new', conversationId: 'c1',
            sender: { id: 'u1', name: 'Me', type: 'human' },
            contentType: 'text', content: { text: 'hello' },
            timestamp: '2026-05-01T00:00:00Z', status: 'sent',
          },
        });
      }),
    );
    const m = await svc.sendText('c1', 'hello');
    expect(m.id).toBe('m-new');
    expect(store.listMessages('c1')).toHaveLength(1);
  });
});

describe('ChatService.markRead', () => {
  it('POSTs to /read with optional lastReadMessageId', async () => {
    server.use(
      http.post(`${BASE}/api/v1/conversations/c1/read`, async ({ request }) => {
        const body = await request.json() as { last_read_message_id?: string };
        expect(body.last_read_message_id).toBe('m9');
        return HttpResponse.json({});
      }),
    );
    await svc.markRead('c1', 'm9');
  });
});

describe('ChatService.deleteMessage', () => {
  it('DELETEs /messages/:id and removes from store', async () => {
    server.use(
      http.delete(`${BASE}/api/v1/messages/m1`, () => HttpResponse.json({})),
    );
    store.appendMessages('c1', [{
      id: 'm1', conversationId: 'c1',
      sender: { id: 'u1', name: 'A', type: 'human' },
      contentType: 'text', content: { text: 'x' },
      timestamp: '2026-05-01T00:00:00Z', status: 'sent',
    }]);
    await svc.deleteMessage('c1', 'm1');
    expect(store.listMessages('c1')).toHaveLength(0);
  });
});

describe('ChatService.sendMediaMessage (orchestration mirroring ChatService.swift:552-610)', () => {
  let tmp: string;
  let localFile: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'clawnet-media-'));
    localFile = join(tmp, 'note.txt');
    writeFileSync(localFile, 'hello world', 'utf-8');
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('checkFile-miss → uploadChunk → completeUpload → getFileInfo → sendMediaMessage', async () => {
    const seen: string[] = [];
    server.use(
      http.head(`${BASE}/api/v1/files/check/:hash`, () => {
        seen.push('check');
        return new HttpResponse(null, { status: 404 });
      }),
      http.post(`${BASE}/api/v1/files/upload/:hash/chunk`, () => {
        seen.push('chunk');
        return HttpResponse.json({ status: 'ok' });
      }),
      http.post(`${BASE}/api/v1/files/upload/:hash/complete`, () => {
        seen.push('complete');
        return HttpResponse.json({
          data: { id: 'f1', name: 'note.txt', size: 11, mime_type: 'text/plain' },
        });
      }),
      http.get(`${BASE}/api/v1/files/f1`, () => {
        seen.push('info');
        return HttpResponse.json({
          data: {
            id: 'f1', name: 'note.txt', size: 11, mime_type: 'text/plain',
            url: 'https://x/note.txt',
          },
        });
      }),
      http.post(`${BASE}/api/v1/conversations/c1/messages`, async ({ request }) => {
        seen.push('send');
        const body = (await request.json()) as {
          content_type: string;
          content: Record<string, unknown>;
        };
        expect(body.content_type).toBe('file');
        expect(body.content).toMatchObject({ id: 'f1', name: 'note.txt', size: 11 });
        return HttpResponse.json({
          data: {
            id: 'm1', conversation_id: 'c1',
            sender: { id: 'u1', name: 'u', type: 'human' },
            content_type: 'file', content: body.content,
            timestamp: '2026-05-11T00:00:00Z', status: 'sent',
          },
        });
      }),
    );

    const msg = await svc.sendMediaMessage('c1', localFile);
    expect(seen).toEqual(['check', 'chunk', 'complete', 'info', 'send']);
    expect(msg.id).toBe('m1');
    expect(msg.contentType).toBe('file');
    expect(store.listMessages('c1').map((m) => m.id)).toContain('m1');
  });

  it('checkFile-hit → skip upload, go directly to getFileInfo + sendMediaMessage', async () => {
    const seen: string[] = [];
    server.use(
      http.head(`${BASE}/api/v1/files/check/:hash`, () => {
        seen.push('check');
        return new HttpResponse(null, {
          status: 200,
          headers: { 'X-File-Id': 'f-existing' },
        });
      }),
      http.get(`${BASE}/api/v1/files/f-existing`, () => {
        seen.push('info');
        return HttpResponse.json({
          data: { id: 'f-existing', name: 'note.txt', size: 11, mime_type: 'text/plain' },
        });
      }),
      http.post(`${BASE}/api/v1/conversations/c1/messages`, async () => {
        seen.push('send');
        return HttpResponse.json({
          data: {
            id: 'm2', conversation_id: 'c1',
            sender: { id: 'u1', name: 'u', type: 'human' },
            content_type: 'file',
            content: { id: 'f-existing', name: 'note.txt', size: 11, mime_type: 'text/plain' },
            timestamp: '2026-05-11T00:00:00Z', status: 'sent',
          },
        });
      }),
    );
    const msg = await svc.sendMediaMessage('c1', localFile);
    expect(seen).toEqual(['check', 'info', 'send']);
    expect(msg.id).toBe('m2');
  });

  it('inserts optimistic message via store + emits onMessageCreated BEFORE upload starts', async () => {
    const onMessageCreated = vi.fn();
    const onMessageReplaced = vi.fn();
    const svc2 = new ChatService({
      http: http_, store, files,
      onMessageCreated,
      onMessageReplaced,
    });

    let checkSeenAfterOptimistic = false;
    server.use(
      http.head(`${BASE}/api/v1/files/check/:hash`, () => {
        // By now the optimistic record must already exist in the store.
        checkSeenAfterOptimistic = store.findMessageById('temp-A') !== undefined;
        return new HttpResponse(null, {
          status: 200,
          headers: { 'X-File-Id': 'f-existing' },
        });
      }),
      http.get(`${BASE}/api/v1/files/f-existing`, () =>
        HttpResponse.json({
          data: { id: 'f-existing', name: 'note.txt', size: 11, mime_type: 'text/plain' },
        }),
      ),
      http.post(`${BASE}/api/v1/conversations/c1/messages`, () =>
        HttpResponse.json({
          data: {
            id: 'm-real', conversation_id: 'c1',
            sender: { id: 'u1', name: 'u', type: 'human' },
            content_type: 'file',
            content: { id: 'f-existing', name: 'note.txt', size: 11, mime_type: 'text/plain' },
            timestamp: '2026-05-11T00:00:00Z', status: 'sent',
          },
        }),
      ),
    );

    await svc2.sendMediaMessage('c1', localFile, 'temp-A');

    expect(checkSeenAfterOptimistic).toBe(true);
    expect(onMessageCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'temp-A', status: 'sending' }),
    );
    expect(onMessageReplaced).toHaveBeenCalledWith({
      tempId: 'temp-A',
      real: expect.objectContaining({ id: 'm-real' }),
    });
    // After swap, the temp id is gone and the real one is present.
    expect(store.findMessageById('temp-A')).toBeUndefined();
    expect(store.findMessageById('m-real')).toBeDefined();
  });

  it('emits onUploadProgress once per chunk for multi-chunk uploads', async () => {
    // Build a 600 KB file → 3 chunks @ 256 KB.
    const bigFile = join(tmp, 'big.bin');
    writeFileSync(bigFile, Buffer.alloc(600 * 1024));

    const onUploadProgress = vi.fn();
    const svc2 = new ChatService({
      http: http_, store, files,
      onUploadProgress,
    });

    const chunkIndexes: number[] = [];
    server.use(
      http.head(`${BASE}/api/v1/files/check/:hash`, () => new HttpResponse(null, { status: 404 })),
      http.post(`${BASE}/api/v1/files/upload/:hash/chunk`, ({ request }) => {
        chunkIndexes.push(Number(new URL(request.url).searchParams.get('chunk_index')));
        return HttpResponse.json({ status: 'ok' });
      }),
      http.post(`${BASE}/api/v1/files/upload/:hash/complete`, async ({ request }) => {
        const body = (await request.json()) as { total_chunks: number };
        expect(body.total_chunks).toBe(3);
        return HttpResponse.json({
          data: { id: 'f-big', name: 'big.bin', size: 600 * 1024, mime_type: 'application/octet-stream' },
        });
      }),
      http.get(`${BASE}/api/v1/files/f-big`, () =>
        HttpResponse.json({
          data: { id: 'f-big', name: 'big.bin', size: 600 * 1024, mime_type: 'application/octet-stream' },
        }),
      ),
      http.post(`${BASE}/api/v1/conversations/c1/messages`, () =>
        HttpResponse.json({
          data: {
            id: 'm-big', conversation_id: 'c1',
            sender: { id: 'u1', name: 'u', type: 'human' },
            content_type: 'file',
            content: { id: 'f-big', name: 'big.bin', size: 600 * 1024 },
            timestamp: '2026-05-11T00:00:00Z', status: 'sent',
          },
        }),
      ),
    );

    await svc2.sendMediaMessage('c1', bigFile, 'temp-B');

    expect(chunkIndexes).toEqual([0, 1, 2]);
    expect(onUploadProgress).toHaveBeenCalledTimes(3);
    expect(onUploadProgress).toHaveBeenLastCalledWith({
      tempId: 'temp-B',
      bytesSent: 600 * 1024,
      totalBytes: 600 * 1024,
    });
  });

  it('emits a single 100% onUploadProgress on de-dup hit (checkFile-hit)', async () => {
    const onUploadProgress = vi.fn();
    const svc2 = new ChatService({
      http: http_, store, files,
      onUploadProgress,
    });
    server.use(
      http.head(`${BASE}/api/v1/files/check/:hash`, () =>
        new HttpResponse(null, { status: 200, headers: { 'X-File-Id': 'f-existing' } }),
      ),
      http.get(`${BASE}/api/v1/files/f-existing`, () =>
        HttpResponse.json({
          data: { id: 'f-existing', name: 'note.txt', size: 11, mime_type: 'text/plain' },
        }),
      ),
      http.post(`${BASE}/api/v1/conversations/c1/messages`, () =>
        HttpResponse.json({
          data: {
            id: 'm-dedup', conversation_id: 'c1',
            sender: { id: 'u1', name: 'u', type: 'human' },
            content_type: 'file',
            content: { id: 'f-existing', name: 'note.txt', size: 11, mime_type: 'text/plain' },
            timestamp: '2026-05-11T00:00:00Z', status: 'sent',
          },
        }),
      ),
    );

    await svc2.sendMediaMessage('c1', localFile, 'temp-C');

    expect(onUploadProgress).toHaveBeenCalledTimes(1);
    expect(onUploadProgress).toHaveBeenCalledWith({
      tempId: 'temp-C',
      bytesSent: 11,
      totalBytes: 11,
    });
  });

  it('emits onUploadFailed + markOptimisticFailed when uploadChunk throws', async () => {
    const onUploadFailed = vi.fn();
    const svc2 = new ChatService({
      http: http_, store, files,
      onUploadFailed,
    });
    server.use(
      http.head(`${BASE}/api/v1/files/check/:hash`, () => new HttpResponse(null, { status: 404 })),
      http.post(`${BASE}/api/v1/files/upload/:hash/chunk`, () => new HttpResponse(null, { status: 500 })),
    );

    await expect(svc2.sendMediaMessage('c1', localFile, 'temp-D')).rejects.toThrow();

    expect(onUploadFailed).toHaveBeenCalledWith(
      expect.objectContaining({ tempId: 'temp-D' }),
    );
    expect(store.findMessageById('temp-D')?.status).toBe('failed');
  });

  it('cancelUpload aborts in-flight upload + emits onUploadFailed with reason=cancelled', async () => {
    const onUploadFailed = vi.fn();
    const svc2 = new ChatService({
      http: http_, store, files,
      onUploadFailed,
    });
    server.use(
      http.head(`${BASE}/api/v1/files/check/:hash`, () => new HttpResponse(null, { status: 404 })),
      http.post(`${BASE}/api/v1/files/upload/:hash/chunk`, async () => {
        // Slow handler — gives the test time to call cancelUpload before
        // the chunk completes.
        await new Promise((r) => setTimeout(r, 200));
        return HttpResponse.json({ status: 'ok' });
      }),
    );

    const promise = svc2.sendMediaMessage('c1', localFile, 'temp-cancel');
    // Wait for the optimistic insert + first chunk fetch to begin, then
    // cancel.
    await new Promise((r) => setTimeout(r, 20));
    const cancelled = svc2.cancelUpload('temp-cancel');
    expect(cancelled).toBe(true);

    await expect(promise).rejects.toThrow();
    expect(onUploadFailed).toHaveBeenCalledWith({
      tempId: 'temp-cancel',
      reason: 'cancelled',
    });
    expect(store.findMessageById('temp-cancel')?.status).toBe('failed');
  });

  it('cancelUpload returns false for unknown tempId', () => {
    const svc2 = new ChatService({ http: http_, store, files });
    expect(svc2.cancelUpload('does-not-exist')).toBe(false);
  });

  it('omits clientTempId from the POST /messages body (server ignores it)', async () => {
    // Verified against the actual server source: `grep client_temp_id` in
    // clawnet-server returns 0 hits. The optimistic-to-real swap is
    // driven by the local replaceOptimistic + chat.message.replaced IPC,
    // not by a server echo. We assert the field is *absent* so we don't
    // accidentally re-add wire noise.
    let bodySeen: Record<string, unknown> | undefined;
    server.use(
      http.head(`${BASE}/api/v1/files/check/:hash`, () =>
        new HttpResponse(null, { status: 200, headers: { 'X-File-Id': 'f-existing' } }),
      ),
      http.get(`${BASE}/api/v1/files/f-existing`, () =>
        HttpResponse.json({
          data: { id: 'f-existing', name: 'note.txt', size: 11, mime_type: 'text/plain' },
        }),
      ),
      http.post(`${BASE}/api/v1/conversations/c1/messages`, async ({ request }) => {
        bodySeen = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          data: {
            id: 'm-tc', conversation_id: 'c1',
            sender: { id: 'u1', name: 'u', type: 'human' },
            content_type: 'file',
            content: { id: 'f-existing', name: 'note.txt', size: 11, mime_type: 'text/plain' },
            timestamp: '2026-05-11T00:00:00Z', status: 'sent',
          },
        });
      }),
    );

    await svc.sendMediaMessage('c1', localFile, 'temp-E');
    expect(bodySeen).toBeDefined();
    expect(bodySeen!.client_temp_id).toBeUndefined();
    expect(bodySeen!.clientTempId).toBeUndefined();
  });
});

describe('ChatService.createDirectConversation', () => {
  it('POSTs /api/v1/conversations with type=direct + participant_ids', async () => {
    server.use(
      http.post(`${BASE}/api/v1/conversations`, async ({ request }) => {
        const body = await request.json() as { type: string; participant_ids: string[] };
        expect(body.type).toBe('direct');
        expect(body.participant_ids).toEqual(['u-other']);
        return HttpResponse.json({ data: {
          id: 'c-new', type: 'direct',
          participants: [{ id: 'u-other', name: 'Other', type: 'human' }],
          unread_count: 0,
          created_at: '2026-05-12T00:00:00Z',
          updated_at: '2026-05-12T00:00:00Z',
        } });
      }),
    );
    const conv = await svc.createDirectConversation('u-other');
    expect(conv.id).toBe('c-new');
    expect(conv.type).toBe('direct');
    expect(store.listConversations().find((c) => c.id === 'c-new')).toBeDefined();
  });
});

describe('ChatService.createGroupConversation (ClawNetAPI.swift:35-45)', () => {
  it('POSTs type=group + participant_ids + optional title; parses Conversation response', async () => {
    server.use(
      http.post(`${BASE}/api/v1/conversations`, async ({ request }) => {
        const body = await request.json() as { type: string; participant_ids: string[]; title?: string };
        expect(body.type).toBe('group');
        expect(body.participant_ids).toEqual(['u-a', 'u-b']);
        expect(body.title).toBe('Project sync');
        return HttpResponse.json({ data: {
          id: 'c-grp', type: 'group', title: 'Project sync',
          participants: [
            { id: 'u-me', name: 'Me', type: 'human', role: 'owner' },
            { id: 'u-a', name: 'Alice', type: 'human', role: 'member' },
            { id: 'u-b', name: 'Bob', type: 'human', role: 'member' },
          ],
          unread_count: 0,
          created_at: '2026-05-12T00:00:00Z',
          updated_at: '2026-05-12T00:00:00Z',
        } });
      }),
    );
    const conv = await svc.createGroupConversation(['u-a', 'u-b'], 'Project sync');
    expect(conv.id).toBe('c-grp');
    expect(conv.type).toBe('group');
    expect(conv.participants).toHaveLength(3);
    expect(conv.participants[0]?.role).toBe('owner');
  });

  it('throws when fewer than 2 participantIds provided', async () => {
    await expect(svc.createGroupConversation(['u-a'])).rejects.toThrow(/at least 2/i);
  });

  it('omits title from the wire body when not provided', async () => {
    server.use(
      http.post(`${BASE}/api/v1/conversations`, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        expect('title' in body).toBe(false);
        return HttpResponse.json({ data: {
          id: 'c-x', type: 'group',
          participants: [{ id: 'u-a', name: 'A', type: 'human' }, { id: 'u-b', name: 'B', type: 'human' }],
          unread_count: 0,
          created_at: '2026-05-12T00:00:00Z',
          updated_at: '2026-05-12T00:00:00Z',
        } });
      }),
    );
    await svc.createGroupConversation(['u-a', 'u-b']);
  });
});

describe('ChatService.getMembers (ClawNetAPI.swift:74-78)', () => {
  it('GETs /api/v1/conversations/:id/members + parses Participant[]', async () => {
    server.use(
      http.get(`${BASE}/api/v1/conversations/c-grp/members`, () =>
        HttpResponse.json({ data: [
          { id: 'u-me', name: 'Me', type: 'human', role: 'owner' },
          { id: 'u-a', name: 'Alice', type: 'human', role: 'admin' },
        ] }),
      ),
    );
    const out = await svc.getMembers('c-grp');
    expect(out).toHaveLength(2);
    expect(out[0]?.role).toBe('owner');
  });
});

describe('ChatService.addMembers (ClawNetAPI.swift:80-85)', () => {
  it('POSTs participant_ids + parses updated Participant[] response', async () => {
    server.use(
      http.post(`${BASE}/api/v1/conversations/c-grp/members`, async ({ request }) => {
        const body = await request.json() as { participant_ids: string[] };
        expect(body.participant_ids).toEqual(['u-c']);
        return HttpResponse.json({ data: [{ id: 'u-c', name: 'Carol', type: 'human', role: 'member' }] });
      }),
    );
    const added = await svc.addMembers('c-grp', ['u-c']);
    expect(added[0]?.id).toBe('u-c');
  });

  it('throws when participantIds is empty', async () => {
    await expect(svc.addMembers('c-grp', [])).rejects.toThrow(/at least 1/i);
  });
});

describe('ChatService.removeMember (ClawNetAPI.swift:87-89)', () => {
  it('DELETEs /api/v1/conversations/:id/members/:memberId', async () => {
    let called = false;
    server.use(
      http.delete(`${BASE}/api/v1/conversations/c-grp/members/u-a`, () => {
        called = true; return new HttpResponse(null, { status: 204 });
      }),
    );
    await svc.removeMember('c-grp', 'u-a');
    expect(called).toBe(true);
  });
});

describe('ChatService.updateConversationTitle (ClawNetAPI.swift:60-65)', () => {
  it('PATCHes /api/v1/conversations/:id with title body + parses Conversation response', async () => {
    server.use(
      http.patch(`${BASE}/api/v1/conversations/c-grp`, async ({ request }) => {
        const body = await request.json() as { title?: string; summary?: string };
        expect(body.title).toBe('Renamed Group');
        expect('summary' in body).toBe(false);
        return HttpResponse.json({ data: {
          id: 'c-grp', type: 'group', title: 'Renamed Group',
          participants: [],
          unread_count: 0,
          created_at: '2026-05-12T00:00:00Z',
          updated_at: '2026-05-12T00:00:01Z',
        } });
      }),
    );
    const conv = await svc.updateConversationTitle('c-grp', 'Renamed Group');
    expect(conv.title).toBe('Renamed Group');
  });
});

describe('ChatService.updateConversationSummary (ClawNetAPI.swift:67-72)', () => {
  it('PATCHes with summary body', async () => {
    server.use(
      http.patch(`${BASE}/api/v1/conversations/c-grp`, async ({ request }) => {
        const body = await request.json() as { summary?: string };
        expect(body.summary).toBe('Daily standup chat');
        return HttpResponse.json({ data: {
          id: 'c-grp', type: 'group', summary: 'Daily standup chat',
          participants: [],
          unread_count: 0,
          created_at: '2026-05-12T00:00:00Z',
          updated_at: '2026-05-12T00:00:02Z',
        } });
      }),
    );
    const conv = await svc.updateConversationSummary('c-grp', 'Daily standup chat');
    expect(conv.summary).toBe('Daily standup chat');
  });
});

describe('ChatService.searchMessages (ClawNetAPI.swift:157-163)', () => {
  it('GETs /api/v1/search/messages with q= + parses ChatMessage[]', async () => {
    server.use(
      http.get(`${BASE}/api/v1/search/messages`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('q')).toBe('hello world');
        return HttpResponse.json({ data: [{
          id: 'm-hit', conversation_id: 'c1',
          sender: { id: 'u1', name: 'U', type: 'human' },
          content_type: 'text',
          content: { text: 'hello world' },
          timestamp: '2026-05-12T00:00:00Z',
          status: 'sent',
        }] });
      }),
    );
    const out = await svc.searchMessages('hello world');
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('m-hit');
  });

  it('passes optional conversationId scope', async () => {
    server.use(
      http.get(`${BASE}/api/v1/search/messages`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('conversation_id')).toBe('c-target');
        return HttpResponse.json({ data: [] });
      }),
    );
    await svc.searchMessages('any', 'c-target');
  });

  it('returns [] when q is empty (no server call)', async () => {
    // no handler — would 500 if called
    const out = await svc.searchMessages('');
    expect(out).toEqual([]);
    const out2 = await svc.searchMessages('   ');
    expect(out2).toEqual([]);
  });
});
