/**
 * DL-402 — thin client that calls the Worker's own admin endpoints over HTTP.
 *
 * Bot tools wrap existing routes (per CLAUDE.md uniformity rule #1). Rather
 * than reach into route handlers, we mint a short-lived admin token and call
 * the public surface — same as if the bot were an external integration.
 *
 * One round-trip per tool. ~10ms loopback inside Cloudflare's network.
 */

import { signToken } from '../token';
import type { TokenPayload } from '../types';

const ADMIN_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 min — covers a multi-tool turn

export class WorkerApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly secretKey: string
  ) {}

  async get(path: string, query?: Record<string, string | number | undefined>): Promise<unknown> {
    const url = this.buildUrl(path, query);
    const token = await this.mintAdminToken();
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    return await this.unwrap(response, `GET ${path}`);
  }

  async post(path: string, body: Record<string, unknown>, opts?: { withTokenInBody?: boolean }): Promise<unknown> {
    const url = this.buildUrl(path);
    const token = await this.mintAdminToken();
    const finalBody = opts?.withTokenInBody ? { ...body, token } : body;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(finalBody),
    });
    return await this.unwrap(response, `POST ${path}`);
  }

  private buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
    const base = this.baseUrl.replace(/\/+$/, '');
    const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  private async mintAdminToken(): Promise<string> {
    // Project convention (lib/token.ts generateAdminToken + verifyToken): exp/iat
    // are Date.now() milliseconds, not Unix seconds. Mismatching units silently
    // marks every token as already-expired — caught during DL-402 M1 live test.
    const now = Date.now();
    const payload: TokenPayload = {
      type: 'admin',
      iat: now,
      exp: now + ADMIN_TOKEN_TTL_MS,
    };
    return await signToken(payload, this.secretKey);
  }

  private async unwrap(response: Response, label: string): Promise<unknown> {
    const text = await response.text();
    // DL-402 M1 live debug — remove once dashboard tool path is verified.
    console.log(`[telegram-bot/worker-api] ${label} status=${response.status} body=${text.slice(0, 500)}`);
    if (!response.ok) {
      throw new Error(`worker_api_${response.status} (${label}): ${text.slice(0, 200)}`);
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`worker_api_invalid_json (${label})`);
    }
  }
}
