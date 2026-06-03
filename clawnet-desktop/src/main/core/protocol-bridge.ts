import { protocol } from 'electron';

export interface ProtocolBridgeDeps {
  serverURL: () => string;
  getAccessToken: () => Promise<string | null>;
  refreshIfNeeded: () => Promise<void>;
}

const SCHEME = 'clawnet-file';

export function installProtocolBridge(deps: ProtocolBridgeDeps): void {
  protocol.handle(SCHEME, async (req) => {
    // URL shape: clawnet-file://{fileId}   (variant suffix reserved for future
    // /thumbnail support; not used yet).
    const fileId = req.url.slice(`${SCHEME}://`.length).split('/')[0];
    if (!fileId) return new Response(null, { status: 400 });

    const upstream = (token: string) =>
      fetch(`${deps.serverURL()}/api/v1/files/${encodeURIComponent(fileId)}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });

    const token1 = await deps.getAccessToken();
    if (!token1) return new Response(null, { status: 401 });

    let res = await upstream(token1);
    if (res.status === 401) {
      await deps.refreshIfNeeded();
      const token2 = await deps.getAccessToken();
      if (!token2) return res;
      res = await upstream(token2);
    }
    return res;
  });
}
