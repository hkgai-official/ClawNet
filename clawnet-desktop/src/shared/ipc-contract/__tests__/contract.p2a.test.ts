// src/shared/ipc-contract/__tests__/contract.p2a.test.ts
import { describe, it, expect } from 'vitest';
import { Requests, Events } from '../index';

describe('IPC contract P2A — file upload/download additions', () => {
  it('chat.sendFile request registered with conversationId+localPath input', () => {
    const r = Requests['chat.sendFile'];
    expect(r.kind).toBe('request');
    const ok = r.input.safeParse({ conversationId: 'c1', localPath: '/tmp/a.txt' });
    expect(ok.success).toBe(true);
    const bad = r.input.safeParse({ conversationId: 'c1' });
    expect(bad.success).toBe(false);
  });

  it('chat.downloadFile request registered with fileId+suggestedName input', () => {
    const r = Requests['chat.downloadFile'];
    expect(r.kind).toBe('request');
    const ok = r.input.safeParse({ fileId: 'f1', suggestedName: 'a.txt' });
    expect(ok.success).toBe(true);
    const outOk = r.output.safeParse({ savedPath: '/Users/x/Downloads/a.txt' });
    expect(outOk.success).toBe(true);
  });

  it('chat.pickFile request registered with empty input + nullable path output', () => {
    const r = Requests['chat.pickFile'];
    expect(r.kind).toBe('request');
    expect(r.input.safeParse({}).success).toBe(true);
    expect(r.output.safeParse({ path: '/tmp/a' }).success).toBe(true);
    expect(r.output.safeParse(null).success).toBe(true);
  });

  it('chat.upload.progress event payload validates tempId/bytesSent/totalBytes', () => {
    const e = Events['chat.upload.progress'];
    expect(e.kind).toBe('event');
    const ok = e.payload.safeParse({ tempId: 'temp-x', bytesSent: 100, totalBytes: 1000 });
    expect(ok.success).toBe(true);
  });

  it('chat.upload.failed event payload validates tempId/reason', () => {
    const e = Events['chat.upload.failed'];
    expect(e.kind).toBe('event');
    const ok = e.payload.safeParse({ tempId: 'temp-x', reason: 'network' });
    expect(ok.success).toBe(true);
  });
});
