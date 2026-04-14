# Workers KV Caching Research — Patterns for Airtable API Proxy

**Date:** 2026-03-24
**Purpose:** Actionable caching patterns for the Cloudflare Workers API layer that proxies Airtable

---

## 1. KV Fundamentals

### Consistency Model
- **Eventually consistent** — writes propagate to all edge locations within ~60 seconds
- Reads from the same location where a write occurred are *usually* immediately visible, but this is **not guaranteed**
- Non-existent keys are also cached (negative caching) — new key creation may not be visible immediately
- For strong consistency needs, Cloudflare recommends Durable Objects instead

### Read/Write Latency
- **Hot reads (cached at edge):** Sub-10ms — served from local edge cache without network hop
- **Cold reads:** Traverse nearest regional tier, then central tier, then central store — progressively slower
- **Write propagation:** Up to 60+ seconds globally; immediate only at the writing location
- KV uses hybrid push/pull replication: frequently-read keys get pushed to edge; infrequent keys are pulled on demand

### Edge Cache TTL (`cacheTtl`)
- **Default: 60 seconds** — how long the edge caches a value before checking upstream
- **Minimum: 30 seconds** — cannot go lower
- KV refreshes cached values from upper tiers in the background before expiry
- Higher `cacheTtl` = better performance but longer staleness window

### Key Expiration (`expirationTtl`)
- Separate from `cacheTtl` — controls when the key is **deleted** from KV entirely
- **Minimum: 60 seconds** — cannot expire keys sooner than 1 minute
- Two forms: `expiration` (absolute epoch seconds) or `expirationTtl` (relative seconds from now)

### Metadata
- Up to 1024 bytes of JSON metadata per key
- Retrievable via `getWithMetadata()` without reading the value
- Useful for: cache versioning, timestamps, ETags, data signatures

---

## 2. Pricing Implications for Caching

| Operation | Cost (per million) | Free tier (daily) | Paid included (monthly) |
|-----------|-------------------|-------------------|------------------------|
| Reads     | $0.50             | 100,000           | 10,000,000             |
| Writes    | $5.00             | 1,000             | 1,000,000              |
| Deletes   | $5.00             | 1,000             | 1,000,000              |
| Lists     | $5.00             | 1,000             | 1,000,000              |
| Storage   | $0.50/GB-month    | 1 GB              | 1 GB                   |

**Key insight:** Reads are 10x cheaper than writes. KV is explicitly optimized for read-heavy workloads. This aligns perfectly with a caching layer — write once (on miss), read many times.

**Rate limit:** Max 1 write per second to the **same key**. Not a concern for cache patterns where keys are written on miss and read many times.

---

## 3. Caching Patterns

### Pattern A: Cache-Aside (Lazy Population)
Worker checks KV first. On miss, fetches from Airtable, writes result to KV with TTL, returns response.

- **Pros:** Only caches data that is actually requested; simple to implement; no wasted writes
- **Cons:** First request after expiry pays full Airtable latency; risk of cache stampede on popular keys
- **Best for:** Dashboard data, client lists, document lists — data read frequently but not on every request

### Pattern B: Read-Through with Background Refresh
Same as cache-aside, but KV's built-in background refresh (when `cacheTtl` is set) automatically refreshes from upper tiers before edge cache expires.

- **Pros:** Subsequent reads rarely hit origin; smoother latency profile
- **Cons:** Still eventually consistent; first cold read is slow
- **Best for:** Hot keys accessed from multiple edge locations

### Pattern C: Write-Through (Explicit Invalidation)
On write operations (approve document, update status), immediately update KV alongside Airtable.

- **Pros:** Cache is always fresh after writes made through the Worker
- **Cons:** Doesn't help with writes made directly in Airtable UI; adds write latency
- **Best for:** Actions performed through the admin portal that should be immediately reflected

### Pattern D: Versioned Keys
Include a version/timestamp in the cache key (e.g., `clients:v3` or `docs:report123:1711234567`). Increment version on writes; old versions expire naturally via TTL.

- **Pros:** No explicit invalidation needed; immune to stale reads after writes
- **Cons:** Storage grows temporarily; requires coordination on version counter
- **Best for:** Data that changes in discrete, trackable events

---

## 4. TTL Strategy by Data Type

| Data Category | Freshness Need | Recommended TTL | Rationale |
|--------------|----------------|-----------------|-----------|
| Client list (names, IDs) | Low — changes rarely | 5-15 minutes | Clients are added infrequently; stale list is acceptable |
| Document list per report | Medium — changes on upload/approval | 60-120 seconds | Must reflect recent uploads within ~2 min |
| Report stage/status | Medium — changes on stage transitions | 60-120 seconds | Admin needs reasonably current stage info |
| Dashboard aggregates (counts by stage) | Low-medium | 2-5 minutes | Aggregate counts tolerate brief staleness |
| Document content/PDFs | Very low — immutable once created | 1 hour+ or no TTL | Documents don't change after generation |
| User-specific session data | N/A — do not cache in KV | Use Durable Objects or cookies | Per-user data has poor cache hit ratio |
| Config/settings | Very low | 10-30 minutes | Rarely changes; long TTL is safe |

**Principle:** TTL should match the *business tolerance for staleness*, not the data's mutation frequency.

---

## 5. Cache Invalidation Approaches

### Approach 1: TTL-Only (Passive Expiration)
Let keys expire naturally. Simplest approach; no invalidation logic needed.

- **Works when:** Staleness of N seconds is acceptable for all consumers
- **Fails when:** User performs an action and expects to see the result immediately (read-after-write)

### Approach 2: Explicit Purge on Write
When a write operation goes through the Worker, delete or overwrite the relevant cache key(s).

- **Works when:** All mutations flow through the Worker
- **Fails when:** Data is also modified directly in Airtable (which it is, frequently)
- **Mitigation:** Combine with short TTL as a safety net

### Approach 3: Hybrid (TTL + Write-Through for Worker Mutations)
Short TTL (60-120s) as baseline. When a write goes through the Worker, immediately update or delete the cache key. This gives read-after-write consistency for portal actions while keeping a safety net for Airtable-direct changes.

- **This is the recommended approach for this project.** Most admin actions go through the Worker; Airtable-direct changes (rare) are covered by short TTL expiry.

### Approach 4: Cache Busting via Query Params
Client includes a timestamp or version in the request. Worker uses it as part of the cache key. After performing a write, client increments the version.

- **Works when:** Client controls the cache key
- **Complexity:** Requires client-side coordination; overkill for most cases

---

## 6. Anti-Patterns to Avoid

### Cache Stampede (Thundering Herd)
When a popular cached key expires, many concurrent requests simultaneously miss the cache and all hit Airtable.

- **Prevention:** Request coalescing — use a lock or "single-flight" pattern where only one request fetches from origin; others wait for the result. In Workers, this can be approximated with `waitUntil()` + Durable Objects, or by writing a sentinel "refreshing" value.
- **Practical risk for this project:** Low. Traffic is ~500 clients + small admin team, not thousands of concurrent requests. Simple TTL is sufficient.

### Stale Reads After Writes
User approves a document, but the next page load shows the old status because the cache hasn't been invalidated.

- **Prevention:** Write-through on mutation endpoints. When the Worker processes an approval, delete/update the cached document list for that report before responding. The client sees fresh data on the next read.
- **This is the #1 UX risk for this project.**

### Unbounded Cache Growth
Caching every unique query result (e.g., per-client document lists for all 500+ clients) without TTL creates ever-growing storage.

- **Prevention:** Always set `expirationTtl` on writes. Use key prefixes for organized namespacing. Rely on KV's built-in expiration rather than manual cleanup.
- **Storage math:** 500 clients x ~5KB per cached response = ~2.5MB total. Well within free tier. Not a real concern at this scale.

### Cache Addiction (Over-Reliance)
System stops functioning when cache is cold or unavailable.

- **Prevention:** Always implement the fallback path to Airtable. Cache miss should be a slower response, not an error. Never assume cache hit.

### Caching User-Specific or Low-Hit-Rate Data
Per-user session state, one-off queries, or data with unique parameters per request will have near-zero cache hit rates.

- **Prevention:** Only cache shared/reusable data. For user-specific data, pass through to Airtable directly or use very short TTLs.

---

## 7. When NOT to Cache

1. **Frequently mutated data accessed immediately after mutation** — if every read follows a write, caching adds complexity without benefit
2. **User-specific data with low reuse** — one user's document list is unlikely to help another user; but in admin portal, the admin views many clients' data repeatedly, so caching still helps
3. **Data requiring strong consistency** — if stale data causes incorrect behavior (e.g., double-approval), use Durable Objects or skip caching
4. **Write-heavy workloads** — KV writes cost 10x reads and are rate-limited to 1/sec per key
5. **Large payloads with low reuse** — KV values max at 25MB, but caching large blobs that are rarely re-read wastes storage and write budget

---

## 8. Recommended Architecture for This Project

### Cache Key Schema
```
clients:list                          → all clients summary
client:{clientId}:reports             → reports for a specific client
report:{reportId}:documents           → document list for a report
report:{reportId}:status              → report stage/status
dashboard:stats:{year}                → aggregate dashboard counts
config:{key}                          → system configuration
```

### Tiered TTL Strategy
- **Tier 1 (Hot/Shared):** Dashboard stats, client list → 5 min TTL, `cacheTtl: 300`
- **Tier 2 (Per-Entity):** Report documents, report status → 90s TTL, `cacheTtl: 60`
- **Tier 3 (Immutable):** Generated PDFs, document content → 1 hour TTL

### Invalidation Strategy
- **All write endpoints** (approve, update status, edit documents) → delete relevant cache keys after successful Airtable write
- **TTL as safety net** → even without explicit invalidation, stale data self-corrects within TTL window
- **No invalidation webhooks from Airtable** → Airtable doesn't support change webhooks reliably; rely on TTL for Airtable-direct changes

### Metrics to Monitor
- Cache hit rate per key prefix (track via `console.log` + Workers Analytics)
- P95 response time with cache hit vs miss
- Airtable API calls per minute (should decrease after caching)
- KV read/write counts vs billing thresholds

---

## 9. Key Principles (from DDIA / Industry)

1. **Cache is an optimization, not a source of truth.** Airtable remains authoritative. Cache miss must always fall through gracefully.
2. **TTL should reflect business tolerance for staleness**, not technical convenience. Ask "how stale can this data be before users notice?" for each data type.
3. **Read-after-write consistency is a UX requirement**, not just a technical one. Users who perform an action must see its effect immediately.
4. **Request coalescing prevents stampedes** — but only matters at scale. At 500 clients, simple TTL is sufficient.
5. **Eventual consistency is fine for read-mostly dashboards.** Admin viewing a list of 500 clients doesn't need real-time accuracy; 2-minute staleness is invisible.
6. **Cache invalidation is hard; TTL expiration is easy.** When in doubt, use short TTLs rather than building complex invalidation logic.
7. **Monitor hit rates.** A cache with <50% hit rate is adding complexity without proportional benefit. Adjust TTLs or caching scope accordingly.

---

## Sources
- Cloudflare KV Documentation (developers.cloudflare.com/kv/)
- Cloudflare KV Concepts: How KV Works
- Cloudflare KV Pricing & Limits
- AWS Builders' Library: Caching Challenges and Strategies
- Facebook TAO: The Power of the Graph (cache invalidation patterns)
- Martin Kleppmann, "Designing Data-Intensive Applications" — caching consistency concepts
