import { ApiError } from '../core/error';
import { deepSnakeToCamel, deepCamelToSnake } from '../../shared/case-conversion';

export interface HttpClientOptions {
  baseURL: string;
  getAccessToken: () => Promise<string | null>;
  onUnauthorized?: () => Promise<boolean>;
}

export interface RequestOpts {
  /** Keys whose VALUES should not be recursed into for snake↔camel conversion.
   *  Used for opaque server-controlled payloads like AuditEvent.operation_details. */
  caseSkipKeys?: string[];
}

const UNAUTH_ROUTES = new Set<string>([
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
  '/api/v1/auth/register',
]);

export class HttpClient {
  constructor(private readonly opts: HttpClientOptions) {}

  async getJson<T = unknown>(path: string, opts?: RequestOpts): Promise<T> {
    return this.request('GET', path, undefined, false, opts);
  }

  async postJson<T = unknown>(path: string, body: unknown, opts?: RequestOpts): Promise<T> {
    return this.request('POST', path, body, false, opts);
  }

  async putJson<T = unknown>(path: string, body: unknown, opts?: RequestOpts): Promise<T> {
    return this.request('PUT', path, body, false, opts);
  }

  async patchJson<T = unknown>(path: string, body: unknown, opts?: RequestOpts): Promise<T> {
    return this.request('PATCH', path, body, false, opts);
  }

  async deleteJson<T = unknown>(path: string, opts?: RequestOpts): Promise<T> {
    return this.request('DELETE', path, undefined, false, opts);
  }

  updateBaseURL(newBase: string): void {
    (this.opts as { baseURL: string }).baseURL = newBase;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    isRetry = false,
    opts?: RequestOpts,
  ): Promise<T> {
    const headers: Record<string, string> = {};

    if (!UNAUTH_ROUTES.has(path)) {
      const token = await this.opts.getAccessToken();
      if (!token) throw new ApiError('notAuthenticated', 'Not authenticated');
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const url = this.opts.baseURL.replace(/\/$/, '') + path;
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      // REST boundary: convert outgoing camelCase keys to server-side snake_case.
      // Pure objects/arrays only — primitives and pre-stringified bodies are not touched.
      const convOpts = opts?.caseSkipKeys ? { skipKeys: opts.caseSkipKeys } : undefined;
      const wireBody =
        typeof body === 'object' && body !== null ? deepCamelToSnake(body, convOpts) : body;
      init.body = JSON.stringify(wireBody);
    }
    const res = await fetch(url, init);

    if (res.status === 401 && !isRetry && !UNAUTH_ROUTES.has(path)) {
      const refreshed = (await this.opts.onUnauthorized?.()) ?? false;
      if (refreshed) return this.request(method, path, body, true, opts);
      throw new ApiError('http_401', 'Not authorized after refresh attempt');
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ApiError(`http_${res.status}`, text || `HTTP ${res.status}`);
    }

    if (res.status === 204) return undefined as T;
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const raw = await res.json();
      // REST boundary: convert incoming snake_case keys to internal camelCase.
      // Services + zod schemas all use camelCase, matching the macOS Codable
      // .convertFromSnakeCase decoder strategy. `caseSkipKeys` opts out for
      // opaque server-controlled payloads (e.g. audit event details).
      const convOpts = opts?.caseSkipKeys ? { skipKeys: opts.caseSkipKeys } : undefined;
      return deepSnakeToCamel(raw, convOpts) as T;
    }
    return (await res.text()) as T;
  }
}
