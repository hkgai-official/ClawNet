import { describe, it, expect, vi, beforeEach } from 'vitest';

const handlers = new Map<string, (req: Request) => Promise<Response>>();

vi.mock('electron', () => ({
  protocol: {
    handle: vi.fn((scheme: string, h: (req: Request) => Promise<Response>) => {
      handlers.set(scheme, h);
    }),
  },
}));

import { installProtocolBridge } from '../protocol-bridge';

const fetchMock = vi.fn();
global.fetch = fetchMock as never;

beforeEach(() => {
  fetchMock.mockReset();
  handlers.clear();
});

describe('clawnet-file:// bridge', () => {
  it('proxies to /api/v1/files/:id/download with Bearer header', async () => {
    const getToken = vi.fn().mockResolvedValue('tok-1');
    const refreshToken = vi.fn();
    installProtocolBridge({
      serverURL: () => 'http://srv.test',
      getAccessToken: getToken,
      refreshIfNeeded: refreshToken,
    });
    fetchMock.mockResolvedValueOnce(new Response('img-bytes', { status: 200 }));

    const handler = handlers.get('clawnet-file')!;
    const res = await handler(new Request('clawnet-file://abc-123'));

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://srv.test/api/v1/files/abc-123/download',
      expect.objectContaining({ headers: { Authorization: 'Bearer tok-1' } }),
    );
  });

  it('on 401, refreshes token and retries once', async () => {
    const getToken = vi.fn().mockResolvedValueOnce('tok-old').mockResolvedValueOnce('tok-new');
    const refreshIfNeeded = vi.fn().mockResolvedValue(undefined);
    installProtocolBridge({
      serverURL: () => 'http://srv.test',
      getAccessToken: getToken,
      refreshIfNeeded,
    });
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response('img-bytes', { status: 200 }));

    const handler = handlers.get('clawnet-file')!;
    const res = await handler(new Request('clawnet-file://abc'));

    expect(refreshIfNeeded).toHaveBeenCalledOnce();
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);
  });

  it('on second 401, propagates the 401 response', async () => {
    const getToken = vi.fn().mockResolvedValue('tok');
    const refreshIfNeeded = vi.fn().mockResolvedValue(undefined);
    installProtocolBridge({
      serverURL: () => 'http://srv.test',
      getAccessToken: getToken,
      refreshIfNeeded,
    });
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));

    const handler = handlers.get('clawnet-file')!;
    const res = await handler(new Request('clawnet-file://abc'));

    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
