/**
 * KV Cache helpers for slow-changing Airtable data (DL-175)
 *
 * Cache-aside pattern: check KV first, fetch from Airtable on miss.
 * TTL-based expiration handles most invalidation; explicit invalidation
 * available for mutation endpoints.
 */

/** Get from KV cache or fetch fresh data and cache it. */
export async function getCachedOrFetch<T>(
  kv: KVNamespace,
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cached = await kv.get(key, 'json');
  if (cached !== null) return cached as T;

  const fresh = await fetcher();
  // Fire-and-forget — don't block response on cache write
  kv.put(key, JSON.stringify(fresh), { expirationTtl: ttlSeconds }).catch(() => {});
  return fresh;
}

/** Delete one or more cache keys (fire-and-forget). */
export function invalidateCache(kv: KVNamespace, ...keys: string[]): void {
  for (const k of keys) {
    kv.delete(k).catch(() => {});
  }
}
