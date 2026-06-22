import { describe, expect, it } from 'vitest';
import { memoryConnectionStore, getAccessToken, refreshAccessToken, type OAuthConnection } from '../src/index.js';

function fakeFetch(response: Record<string, unknown>, ok = true): typeof fetch {
  return (async () =>
    ({
      ok,
      status: ok ? 200 : 400,
      json: async () => response,
      text: async () => JSON.stringify(response),
    }) as Response) as unknown as typeof fetch;
}

const baseConn = (over: Partial<OAuthConnection> = {}): OAuthConnection => ({
  id: 'gcal',
  provider: 'google',
  accessToken: 'old-token',
  refreshToken: 'refresh-xyz',
  tokenUrl: 'https://oauth2.example.com/token',
  clientId: 'cid',
  clientSecret: 'secret',
  expiresAt: 1_000_000,
  ...over,
});

describe('oauth connection manager', () => {
  it('returns the cached token when not near expiry', async () => {
    const store = memoryConnectionStore([baseConn({ expiresAt: 5_000_000 })]);
    const token = await getAccessToken(store, 'gcal', { now: () => 1_000_000, fetchImpl: fakeFetch({ access_token: 'NEW' }) });
    expect(token).toBe('old-token');
  });

  it('refreshes and persists when expired', async () => {
    const store = memoryConnectionStore([baseConn({ expiresAt: 1_000_000 })]);
    const token = await getAccessToken(store, 'gcal', {
      now: () => 2_000_000, // past expiry
      fetchImpl: fakeFetch({ access_token: 'NEW-TOKEN', expires_in: 3600, refresh_token: 'refresh-new' }),
    });
    expect(token).toBe('NEW-TOKEN');
    const persisted = await store.get('gcal');
    expect(persisted?.accessToken).toBe('NEW-TOKEN');
    expect(persisted?.refreshToken).toBe('refresh-new');
    expect(persisted?.expiresAt).toBeGreaterThan(2_000_000);
  });

  it('refreshAccessToken throws on a provider error', async () => {
    await expect(refreshAccessToken(baseConn(), fakeFetch({ error: 'invalid_grant' }, false))).rejects.toThrow(/refresh failed/);
  });

  it('errors for an unknown connection', async () => {
    const store = memoryConnectionStore();
    await expect(getAccessToken(store, 'nope')).rejects.toThrow(/no connection/);
  });

  it('keeps the existing refresh token when the provider omits a new one', async () => {
    const store = memoryConnectionStore([baseConn({ expiresAt: 0 })]);
    await getAccessToken(store, 'gcal', { now: () => 10, fetchImpl: fakeFetch({ access_token: 'A2', expires_in: 60 }) });
    const c = await store.get('gcal');
    expect(c?.refreshToken).toBe('refresh-xyz');
  });
});
