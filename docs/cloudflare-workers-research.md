> **STATUS: RESEARCH COMPLETE** — Migration executed March 2026. See `docs/performance-benchmarks.md` for results.

# Cloudflare Workers + Hono Research Findings

**Date:** 2026-03-23
**Purpose:** Migration feasibility from n8n webhooks to Cloudflare Workers for admin portal API layer

---

## Topic 1: Hono on Cloudflare Workers — Project Structure & Best Practices

### Recommended Project Layout

```
project-root/
├── wrangler.toml          # Worker config, bindings, routes
├── package.json
├── .dev.vars              # Local secrets (gitignored)
├── src/
│   ├── index.ts           # Entry point, mounts sub-routers
│   ├── routes/
│   │   ├── approve.ts     # /api/approve routes
│   │   ├── documents.ts   # /api/documents routes
│   │   └── status.ts      # /api/status routes
│   ├── middleware/
│   │   ├── auth.ts        # HMAC verification middleware
│   │   └── cors.ts        # CORS config
│   └── lib/
│       ├── hmac.ts        # HMAC sign/verify helpers
│       └── airtable.ts    # Airtable API client
└── test/
```

**Source:** [Hono Best Practices](https://hono.dev/docs/guides/best-practices)
**Key finding:** Hono recommends `app.route()` for modular sub-routers — each file exports a Hono instance, mounted in index.ts. Do NOT use Rails-style controllers; write handlers inline to preserve TypeScript path parameter inference.

**Source:** [Hono Cloudflare Workers Getting Started](https://hono.dev/docs/getting-started/cloudflare-workers)
**Key finding:** Environment bindings (secrets, KV, R2) are accessed via `c.env.SECRET_NAME`, typed through generics: `new Hono<{ Bindings: { HMAC_SECRET: string } }>()`. Run `wrangler types` to auto-generate the Env interface from wrangler.toml.

**Our case:** Each n8n webhook endpoint becomes a Hono route. Sub-routers map cleanly to our endpoint groups (approve, view-documents, batch-status). The `c.env` pattern replaces our current n8n credential/environment variable system.

### Middleware Pattern

```ts
// Auth middleware example structure
const authMiddleware = createMiddleware(async (c, next) => {
  const token = c.req.query('token');
  // verify HMAC...
  await next();
});

app.use('/api/*', authMiddleware);
```

**Source:** [Hono Middleware Guide](https://hono.dev/docs/guides/middleware)
**Key finding:** Middleware executes in registration order. Use `createMiddleware()` from `hono/factory` for typed middleware. Middleware MUST call `await next()` to continue the chain.

**Our case:** HMAC token verification becomes a single middleware applied to all `/api/*` routes, replacing the duplicated HMAC check in every n8n workflow's first Code node.

### Module Worker Mode

```ts
export default {
  fetch: app.fetch,
  scheduled: async (batch, env) => { /* cron triggers */ }
}
```

**Source:** [Hono Workers Docs](https://hono.dev/docs/getting-started/cloudflare-workers)
**Key finding:** You can combine Hono's fetch handler with other Worker event handlers (scheduled, queue). This allows a single Worker to handle both HTTP requests AND cron-triggered tasks.

**Our case:** Reminder scheduling could eventually move from n8n cron to Workers scheduled events, but that's a future optimization.

---

## Topic 2: HMAC Authentication on Cloudflare Workers

### Web Crypto API — HMAC-SHA256

```ts
// 1. Import key
const key = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(secret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign", "verify"]
);

// 2. Sign
const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
const base64Mac = btoa(String.fromCharCode(...new Uint8Array(mac)));

// 3. Verify (preferred over sign+compare — timing-safe internally)
const verified = await crypto.subtle.verify(
  "HMAC", key, receivedMacBuffer, encoder.encode(data)
);
```

**Source:** [Cloudflare Sign Requests Example](https://developers.cloudflare.com/workers/examples/signing-requests/)
**Key finding:** `crypto.subtle.verify()` is the preferred method — it performs the comparison internally and is timing-safe. You can also use Node.js `Buffer` with `nodejs_compat` flag, but pure Web Crypto works without it.

**Our case:** Our current n8n HMAC uses Node.js `crypto.createHmac()`. The Workers equivalent uses `crypto.subtle` — different API but identical algorithm. The token format (`recordId:timestamp:signature`) can stay the same; only the signing/verification implementation changes.

### Timing-Safe Comparison

```ts
// For cases where you need raw comparison (not using crypto.subtle.verify)
const a = encoder.encode(value1);
const b = encoder.encode(value2);

// CRITICAL: Do NOT early-return on length mismatch — leaks length info
if (a.byteLength !== b.byteLength) {
  // Compare a against itself + return false (constant time)
  crypto.subtle.timingSafeEqual(a, a);
  return false;
}
return crypto.subtle.timingSafeEqual(a, b);
```

**Source:** [Cloudflare Protect Against Timing Attacks](https://developers.cloudflare.com/workers/examples/protect-against-timing-attacks/)
**Key finding:** `crypto.subtle.timingSafeEqual()` IS available in Workers (it's a Cloudflare extension, not standard Web Crypto). Takes `ArrayBuffer` or `TypedArray`. Buffers MUST be equal length or it throws. The function is NOT constant-time with respect to length — so hash both inputs first if lengths could differ.

**Our case:** Since we use `crypto.subtle.verify()` for HMAC (which is internally timing-safe), we only need `timingSafeEqual` if comparing raw tokens or API keys directly. For HMAC verification, `verify()` is sufficient.

---

## Topic 3: Cloudflare Workers Security Patterns

### Secrets Management

**Source:** [Cloudflare Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
**Key findings:**
- Secrets are set via `wrangler secret put HMAC_SECRET` (prompts for value, never stored in files)
- Accessed in code via `env.HMAC_SECRET` (or `c.env.HMAC_SECRET` in Hono)
- Local dev: `.dev.vars` file with dotenv syntax (gitignored)
- NEVER put secrets in `wrangler.toml` `[vars]` — those are plaintext
- New: `import { env } from "cloudflare:workers"` for top-level access outside handlers
- Secrets Store (beta): account-level secrets shared across Workers

**Our case:** We need these secrets:
- `HMAC_SECRET` — for token signing/verification
- `AIRTABLE_API_KEY` — for Airtable reads/writes
- `N8N_WEBHOOK_SECRET` — if Workers need to call back to n8n

### CORS Middleware in Hono

```ts
import { cors } from 'hono/cors';

app.use('/api/*', cors({
  origin: 'https://liozshor.github.io',  // Our GitHub Pages origin
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
  maxAge: 86400,  // Cache preflight for 24h
}));
```

**Source:** [Hono CORS Middleware](https://hono.dev/docs/middleware/builtin/cors)
**Key finding:** Hono's built-in CORS middleware handles OPTIONS preflight automatically. Supports string, array, or function for origin. Dynamic origin via `origin: (origin, c) => ...` allows environment-based config.

**Our case:** This replaces our manual CORS headers on every n8n Respond to Webhook node (currently 27 nodes across 12 workflows). One line of middleware vs. 27 manual header configurations. The `origin` can use `c.env.ALLOWED_ORIGIN` for environment-specific config.

### waitUntil() — Fire-and-Forget

**Source:** [Cloudflare Workers Context API](https://developers.cloudflare.com/workers/runtime-apis/context/)
**Key findings:**
- `ctx.waitUntil(promise)` extends Worker lifetime up to **30 seconds** after response is sent
- Multiple `waitUntil()` calls allowed; each is independent (like `Promise.allSettled`)
- If a waitUntil promise rejects, others continue — no cascading failures
- **Gotcha: 30s hard limit** — if work takes longer, it's cancelled silently
- **Gotcha: Request body must be read BEFORE returning response** if waitUntil needs it
- **Gotcha: Don't destructure `ctx`** — loses `this` binding, throws "Illegal invocation"
- New: `import { waitUntil } from "cloudflare:workers"` for use anywhere without passing ctx
- For guaranteed delivery, use Cloudflare Queues instead

**Our case:** Perfect for: (1) logging/analytics after returning approval response, (2) triggering n8n webhook callbacks after responding to client. The 30s limit is fine for our use cases — Airtable writes typically complete in 1-3 seconds.

---

## Topic 4: Performance — Workers Edge Latency

### Israel Edge Presence

**Source:** [Cloudflare Tel Aviv Data Center Announcement](https://blog.cloudflare.com/tel-aviv/)
**Source:** [Cloudflare Mid-2022 New Cities](https://blog.cloudflare.com/mid-2022-new-cities/)
**Key finding:** Cloudflare has **2 data centers in Israel** — Tel Aviv and Haifa. These serve practically all Israeli requests locally. Measured improvement: median latency dropped from **86ms to 29ms** (66% reduction) for an Israeli ISP after Tel Aviv/Haifa deployment.

**Our case:** Our users (Israeli CPA firm clients and office staff) will hit the Tel Aviv/Haifa edge. Current path: Browser -> GitHub Pages -> n8n Cloud (EU region). New path: Browser -> Cloudflare Worker (Tel Aviv edge) -> Airtable API. The n8n hop is eliminated entirely for read operations.

### Cold Starts

**Source:** [Cloudflare Eliminating Cold Starts](https://blog.cloudflare.com/eliminating-cold-starts-with-cloudflare-workers/)
**Key findings:**
- Workers use **V8 isolates**, not containers — warm-up is **<5ms** (vs. "full seconds" for container-based serverless)
- Cloudflare claims **zero cold starts** for root hostname deployments (preloads during TLS handshake)
- V8 isolate model: ~128KB memory overhead vs. ~35MB for a Node.js container
- 210% faster than Lambda@Edge, 298% faster than Lambda in benchmarks

**Our case:** n8n webhooks have observable latency (~500ms-2s for first request after idle). Workers eliminate this entirely. For the admin portal approval flow (where office staff clicks "approve" and expects instant feedback), this is a meaningful UX improvement.

### Expected Latency Comparison

| Path | Estimated Latency |
|------|------------------|
| Current: Browser -> GH Pages -> n8n Cloud (EU) -> Airtable | ~800-1500ms |
| Workers: Browser -> CF Edge (TLV) -> Airtable API | ~100-300ms |
| Workers with KV cache: Browser -> CF Edge (TLV) -> KV | ~30-50ms |

The biggest win is eliminating the n8n Cloud round-trip (EU-based servers) for Israeli users. Airtable API latency (~100-200ms from any region) becomes the bottleneck, which could later be mitigated with KV caching for read-heavy operations.

---

## Summary: Migration Applicability

| Concern | n8n Webhooks (Current) | Cloudflare Workers (Proposed) |
|---------|----------------------|-------------------------------|
| CORS | Manual headers on 27 nodes | 1 middleware line |
| HMAC auth | Duplicated in each workflow | 1 middleware |
| Secrets | n8n credentials UI | `wrangler secret put` + `c.env` |
| Cold starts | 500ms-2s after idle | <5ms (effectively zero) |
| Israel latency | ~800-1500ms (EU hop) | ~100-300ms (TLV edge) |
| Fire-and-forget | Not supported (blocks response) | `waitUntil()` with 30s budget |
| Deployment | n8n UI / MCP | `wrangler deploy` (CLI/CI) |
| Type safety | None (plain JS in Code nodes) | Full TypeScript with Hono |
| Observability | n8n execution logs | Workers Logs + Tail |

---

## Sources

- [Hono Best Practices](https://hono.dev/docs/guides/best-practices)
- [Hono Cloudflare Workers Getting Started](https://hono.dev/docs/getting-started/cloudflare-workers)
- [Hono CORS Middleware](https://hono.dev/docs/middleware/builtin/cors)
- [Hono Routing](https://hono.dev/docs/api/routing)
- [Hono Middleware Guide](https://hono.dev/docs/guides/middleware)
- [Cloudflare Workers Best Practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Cloudflare Sign Requests Example](https://developers.cloudflare.com/workers/examples/signing-requests/)
- [Cloudflare Web Crypto API](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- [Cloudflare Protect Against Timing Attacks](https://developers.cloudflare.com/workers/examples/protect-against-timing-attacks/)
- [Cloudflare Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare Workers Context API (waitUntil)](https://developers.cloudflare.com/workers/runtime-apis/context/)
- [Cloudflare Eliminating Cold Starts](https://blog.cloudflare.com/eliminating-cold-starts-with-cloudflare-workers/)
- [Cloudflare Tel Aviv Data Center](https://blog.cloudflare.com/tel-aviv/)
- [Cloudflare Mid-2022 New Cities](https://blog.cloudflare.com/mid-2022-new-cities/)
- [Cloudflare Workers CPU Performance Benchmarks](https://blog.cloudflare.com/unpacking-cloudflare-workers-cpu-performance-benchmarks/)
- [Brady Joslin: Sign and Verify with HMAC Using Web Crypto](https://bradyjoslin.com/posts/webcrypto-signing/)
- [BigBinary: HMAC Auth with Cloudflare Workers](https://www.bigbinary.com/blog/how-to-cache-all-files-using-cloudflare-worker-along-with-hmac-authentication)
- [FreeCodeCamp: Production-Ready Apps with Hono](https://www.freecodecamp.org/news/build-production-ready-web-apps-with-hono/)
