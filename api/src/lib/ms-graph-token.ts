import type { Env } from './types';

const KV_ACCESS_TOKEN = 'ms_graph_access_token';
const KV_REFRESH_TOKEN = 'ms_graph_refresh_token';
const KV_REFRESHING_LOCK = 'ms_graph_refreshing';

const ACCESS_TOKEN_TTL = 3300; // 55 minutes
const LOCK_TTL = 60;           // 60 seconds safety valve (KV minimum TTL)
const LOCK_RETRY_DELAY_MS = 1000;
const LOCK_MAX_RETRIES = 3;

export async function getAccessToken(env: Env, ctx: ExecutionContext): Promise<string> {
  // 1. Check KV for a cached access token
  const cached = await env.TOKEN_CACHE.get(KV_ACCESS_TOKEN);
  if (cached) {
    return cached;
  }

  // 2. Check for an in-progress refresh lock — retry up to 3 times
  for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt++) {
    const lock = await env.TOKEN_CACHE.get(KV_REFRESHING_LOCK);
    if (!lock) break;

    if (attempt === LOCK_MAX_RETRIES - 1) {
      // Lock still set after max retries — stale lock, proceed anyway
      console.error('[ms-graph-token] Stale refresh lock detected, proceeding with refresh');
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS));

    // After waiting, the access token may now be available
    const retryHit = await env.TOKEN_CACHE.get(KV_ACCESS_TOKEN);
    if (retryHit) {
      return retryHit;
    }
  }

  // 3. Acquire lock
  await env.TOKEN_CACHE.put(KV_REFRESHING_LOCK, '1', { expirationTtl: LOCK_TTL });

  // 4. Resolve refresh token: KV (rotated) first, fallback to env seed
  const kvRefreshToken = await env.TOKEN_CACHE.get(KV_REFRESH_TOKEN);
  const refreshToken = kvRefreshToken ?? env.MS_GRAPH_REFRESH_TOKEN;

  // 5. Exchange refresh token for a new access token
  const tokenUrl = `https://login.microsoftonline.com/${env.MS_GRAPH_TENANT_ID}/oauth2/v2.0/token`;

  let response: Response;
  try {
    response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.MS_GRAPH_CLIENT_ID,
        client_secret: env.MS_GRAPH_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: 'https://graph.microsoft.com/.default offline_access',
      }),
    });
  } catch (err) {
    await env.TOKEN_CACHE.delete(KV_REFRESHING_LOCK);
    throw new Error(`[ms-graph-token] Network error contacting token endpoint: ${String(err)}`);
  }

  let body: Record<string, unknown>;
  try {
    body = await response.json() as Record<string, unknown>;
  } catch {
    await env.TOKEN_CACHE.delete(KV_REFRESHING_LOCK);
    throw new Error(`[ms-graph-token] Token endpoint returned non-JSON response (HTTP ${response.status})`);
  }

  // 6. Handle failure
  if (!response.ok || !body.access_token) {
    await env.TOKEN_CACHE.delete(KV_REFRESHING_LOCK);
    const description = (body.error_description as string | undefined)
      ?? (body.error as string | undefined)
      ?? `HTTP ${response.status}`;
    console.error('[ms-graph-token] Token refresh failed:', description);
    throw new Error(`[ms-graph-token] Failed to refresh MS Graph token: ${description}`);
  }

  const accessToken = body.access_token as string;

  // 7. Store access token with TTL
  await env.TOKEN_CACHE.put(KV_ACCESS_TOKEN, accessToken, { expirationTtl: ACCESS_TOKEN_TTL });

  // 8. Persist rotated refresh token if provided
  if (typeof body.refresh_token === 'string' && body.refresh_token) {
    await env.TOKEN_CACHE.put(KV_REFRESH_TOKEN, body.refresh_token);
  }

  // 9. Release lock
  await env.TOKEN_CACHE.delete(KV_REFRESHING_LOCK);

  return accessToken;
}
