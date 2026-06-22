/**
 * OAuth connection manager.
 *
 * Most SaaS integrations authenticate with OAuth access tokens that expire,
 * not static API keys. This module stores connections and transparently
 * refreshes an access token via the provider's token endpoint (the standard
 * `refresh_token` grant) when it's near expiry, persisting the new token.
 *
 * Hosts resolve a fresh token with `getAccessToken(store, id)` and inject it
 * into a node's config / env before a run (or thread it through their own
 * executor wrapper). `fetch` is injectable for testing.
 */

export interface OAuthConnection {
  /** Stable id referenced by workflows/hosts. */
  id: string;
  /** Provider slug, e.g. 'google', 'github', 'slack'. */
  provider: string;
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms when `accessToken` expires. Omitted = never auto-refresh. */
  expiresAt?: number;
  /** Provider token endpoint used for refresh. */
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  /** Any extra provider-specific fields (team id, instance url, …). */
  extra?: Record<string, unknown>;
}

export interface ConnectionStore {
  get(id: string): Promise<OAuthConnection | null>;
  set(conn: OAuthConnection): Promise<void>;
  delete(id: string): Promise<void>;
  list(): Promise<string[]>;
}

/** In-memory connection store. */
export function memoryConnectionStore(seed: OAuthConnection[] = []): ConnectionStore {
  const map = new Map<string, OAuthConnection>(seed.map((c) => [c.id, { ...c }]));
  return {
    async get(id) {
      const c = map.get(id);
      return c ? { ...c } : null;
    },
    async set(conn) {
      map.set(conn.id, { ...conn });
    },
    async delete(id) {
      map.delete(id);
    },
    async list() {
      return Array.from(map.keys());
    },
  };
}

/** JSON file-per-connection store (Node hosts). Lazily imports node:fs. */
export function fileConnectionStore(dir: string): ConnectionStore {
  const fileFor = async (id: string) => {
    const path = await import('node:path');
    return path.join(dir, `${id.replace(/[^a-zA-Z0-9_.-]/g, '_')}.json`);
  };
  return {
    async get(id) {
      try {
        const { readFile } = await import('node:fs/promises');
        return JSON.parse(await readFile(await fileFor(id), 'utf8')) as OAuthConnection;
      } catch {
        return null;
      }
    },
    async set(conn) {
      const { mkdir, writeFile } = await import('node:fs/promises');
      await mkdir(dir, { recursive: true });
      await writeFile(await fileFor(conn.id), JSON.stringify(conn), 'utf8');
    },
    async delete(id) {
      try {
        const { rm } = await import('node:fs/promises');
        await rm(await fileFor(id), { force: true });
      } catch {
        /* ignore */
      }
    },
    async list() {
      try {
        const { readdir } = await import('node:fs/promises');
        return (await readdir(dir)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
      } catch {
        return [];
      }
    },
  };
}

type FetchLike = typeof fetch;

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
}

/**
 * Exchange a refresh token for a fresh access token. Returns the updated
 * connection (does not persist — `getAccessToken` does that). Throws on a
 * non-2xx response or a missing access_token.
 */
export async function refreshAccessToken(
  conn: OAuthConnection,
  fetchImpl: FetchLike = fetch,
): Promise<OAuthConnection> {
  if (!conn.tokenUrl) throw new Error(`oauth: connection "${conn.id}" has no tokenUrl to refresh against`);
  if (!conn.refreshToken) throw new Error(`oauth: connection "${conn.id}" has no refreshToken`);
  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', conn.refreshToken);
  if (conn.clientId) body.set('client_id', conn.clientId);
  if (conn.clientSecret) body.set('client_secret', conn.clientSecret);
  if (conn.scope) body.set('scope', conn.scope);

  const res = await fetchImpl(conn.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`oauth: refresh failed for "${conn.id}": HTTP ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as TokenResponse;
  if (!data.access_token) throw new Error(`oauth: refresh for "${conn.id}" returned no access_token`);
  return {
    ...conn,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? conn.refreshToken,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : conn.expiresAt,
    ...(data.scope ? { scope: data.scope } : {}),
  };
}

export interface GetTokenOptions {
  /** Refresh when within this many ms of expiry. Default 60s. */
  skewMs?: number;
  fetchImpl?: FetchLike;
  /** Inject "now" for testing. */
  now?: () => number;
}

/**
 * Return a valid access token for a stored connection, refreshing and
 * persisting it first when it's expired (or within `skewMs` of expiry).
 */
export async function getAccessToken(
  store: ConnectionStore,
  id: string,
  opts: GetTokenOptions = {},
): Promise<string> {
  const conn = await store.get(id);
  if (!conn) throw new Error(`oauth: no connection "${id}"`);
  const now = opts.now ? opts.now() : Date.now();
  const skew = opts.skewMs ?? 60_000;
  const needsRefresh = conn.expiresAt != null && conn.refreshToken && conn.tokenUrl && conn.expiresAt - skew <= now;
  if (!needsRefresh) return conn.accessToken;
  const refreshed = await refreshAccessToken(conn, opts.fetchImpl);
  await store.set(refreshed);
  return refreshed.accessToken;
}
