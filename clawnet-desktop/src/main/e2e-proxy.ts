// src/main/e2e-proxy.ts
//
// E2E-only network proxy injection. When `CLAWNET_E2E_PROXY` is set
// (e.g. `socks5h://127.0.0.1:1080`), routes ALL outbound HTTP (via
// undici-backed native fetch) and the WS gateway connection through
// the proxy. Used by the prod two-user A2A spec to give each Electron
// instance a distinct egress IP — the prod gateway uses per-IP session
// dedup so two same-host clients otherwise kick each other off.
//
// Only SOCKS5 is supported (the only proxy type our prod test setup
// uses — `ssh -D 1080` from the harness). HTTP CONNECT proxies could
// be added later by switching on `url.protocol`.

import { Agent as UndiciAgent, setGlobalDispatcher } from 'undici';
import type buildConnector from 'undici/types/connector';
import { SocksClient } from 'socks';
import { SocksProxyAgent } from 'socks-proxy-agent';
import type { Socket } from 'node:net';

export interface E2EProxyHandle {
  /** Pass to GatewayChannel.opts.wsFactory so the WS handshake also
   *  routes through the proxy. */
  wsFactory: (url: string) => {
    readyState: number;
    send(data: string): void;
    close(): void;
    on(event: 'open' | 'message' | 'close' | 'error', listener: (...args: never[]) => void): unknown;
  };
}

export function installE2EProxy(proxyUrl: string): E2EProxyHandle {
  const u = new URL(proxyUrl);
  if (u.protocol !== 'socks5:' && u.protocol !== 'socks5h:' && u.protocol !== 'socks:') {
    throw new Error(`installE2EProxy: only SOCKS5 supported, got ${u.protocol}`);
  }
  const proxyHost = u.hostname;
  const proxyPort = Number(u.port);

  const connector: buildConnector.connector = (opts, callback) => {
    SocksClient.createConnection({
      proxy: { host: proxyHost, port: proxyPort, type: 5 },
      command: 'connect',
      destination: { host: opts.hostname, port: Number(opts.port) },
    }).then(
      (info) => callback(null, info.socket as Socket),
      (err) => callback(err as Error, null),
    );
  };
  setGlobalDispatcher(new UndiciAgent({ connect: connector }));

  const socksAgent = new SocksProxyAgent(proxyUrl);
  const wsFactory: E2EProxyHandle['wsFactory'] = (wsUrl) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { WebSocket } = require('ws') as typeof import('ws');
    return new WebSocket(wsUrl, { agent: socksAgent }) as never;
  };

  return { wsFactory };
}
