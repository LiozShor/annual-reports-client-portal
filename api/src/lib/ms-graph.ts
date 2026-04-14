import type { Env } from './types';
import { getAccessToken } from './ms-graph-token';

const KV_ACCESS_TOKEN = 'ms_graph_access_token';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export interface BatchRequest {
  id: string;
  method: string;
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface BatchResponse {
  id: string;
  status: number;
  body: any;
  headers?: Record<string, string>;
}

export class MSGraphClient {
  private env: Env;
  private ctx: ExecutionContext;

  constructor(env: Env, ctx: ExecutionContext) {
    this.env = env;
    this.ctx = ctx;
  }

  async get(path: string): Promise<any> {
    return this.request('GET', path);
  }

  async post(path: string, body?: unknown): Promise<any> {
    return this.request('POST', path, body);
  }

  async patch(path: string, body: unknown): Promise<any> {
    return this.request('PATCH', path, body);
  }

  /** GET binary content (e.g. file download, PDF conversion). Returns ArrayBuffer. */
  async getBinary(path: string): Promise<ArrayBuffer> {
    const token = await getAccessToken(this.env, this.ctx);
    const url = `${GRAPH_BASE}${path}`;
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };

    let response = await fetch(url, { headers });

    if (response.status === 401) {
      await this.env.TOKEN_CACHE.delete(KV_ACCESS_TOKEN);
      const freshToken = await getAccessToken(this.env, this.ctx);
      headers.Authorization = `Bearer ${freshToken}`;
      response = await fetch(url, { headers });
    }

    if (!response.ok) {
      let errorDetail = `HTTP ${response.status}`;
      try {
        const errBody = await response.json() as any;
        errorDetail = errBody?.error?.message ?? errorDetail;
      } catch { /* ignore */ }
      throw new Error(`[ms-graph] GET binary ${path} failed: ${errorDetail}`);
    }

    return response.arrayBuffer();
  }

  /** DELETE a resource. */
  async delete(path: string): Promise<void> {
    const token = await getAccessToken(this.env, this.ctx);
    const url = `${GRAPH_BASE}${path}`;
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };

    let response = await fetch(url, { method: 'DELETE', headers });

    if (response.status === 401) {
      await this.env.TOKEN_CACHE.delete(KV_ACCESS_TOKEN);
      const freshToken = await getAccessToken(this.env, this.ctx);
      headers.Authorization = `Bearer ${freshToken}`;
      response = await fetch(url, { method: 'DELETE', headers });
    }

    if (!response.ok && response.status !== 204) {
      let errorDetail = `HTTP ${response.status}`;
      try {
        const errBody = await response.json() as any;
        errorDetail = errBody?.error?.message ?? errorDetail;
      } catch { /* ignore */ }
      throw new Error(`[ms-graph] DELETE ${path} failed: ${errorDetail}`);
    }
  }

  /** Upload binary content (e.g. file to OneDrive). */
  async putBinary(path: string, body: ArrayBuffer | ReadableStream): Promise<any> {
    const token = await getAccessToken(this.env, this.ctx);
    const url = `${GRAPH_BASE}${path}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
    };

    let response = await fetch(url, { method: 'PUT', headers, body });

    // Auto-retry once on 401
    if (response.status === 401) {
      await this.env.TOKEN_CACHE.delete(KV_ACCESS_TOKEN);
      const freshToken = await getAccessToken(this.env, this.ctx);
      headers.Authorization = `Bearer ${freshToken}`;
      response = await fetch(url, { method: 'PUT', headers, body });
    }

    if (!response.ok) {
      let errorDetail = `HTTP ${response.status}`;
      try {
        const errBody = await response.json() as any;
        errorDetail = errBody?.error?.message ?? errorDetail;
      } catch {
        // ignore parse error
      }
      console.error(`[ms-graph] PUT ${path} failed: ${errorDetail}`);
      throw new Error(`[ms-graph] PUT ${path} failed: ${errorDetail}`);
    }

    if (response.status === 204 || response.status === 202) {
      return null;
    }

    return response.json();
  }

  private async request(method: string, path: string, body?: unknown): Promise<any> {
    const token = await getAccessToken(this.env, this.ctx);
    const url = `${GRAPH_BASE}${path}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const init: RequestInit = {
      method,
      headers,
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    let response = await fetch(url, init);

    // Auto-retry once on 401 — token may have expired mid-request
    if (response.status === 401) {
      await this.env.TOKEN_CACHE.delete(KV_ACCESS_TOKEN);
      const freshToken = await getAccessToken(this.env, this.ctx);
      headers.Authorization = `Bearer ${freshToken}`;
      response = await fetch(url, { ...init, headers });
    }

    if (!response.ok) {
      let errorDetail = `HTTP ${response.status}`;
      try {
        const errBody = await response.json() as any;
        errorDetail = errBody?.error?.message ?? errorDetail;
      } catch {
        // ignore parse error
      }
      console.error(`[ms-graph] ${method} ${path} failed: ${errorDetail}`);
      throw new Error(`[ms-graph] ${method} ${path} failed: ${errorDetail}`);
    }

    // 204 No Content / 202 Accepted — return null
    if (response.status === 204 || response.status === 202) {
      return null;
    }

    return response.json();
  }

  /**
   * Send an email via MS Graph.
   * Returns void (202 Accepted with empty body).
   */
  async sendMail(
    subject: string,
    htmlContent: string,
    toAddress: string,
    fromMailbox: string = 'me',
    ccAddress?: string
  ): Promise<void> {
    const path = fromMailbox === 'me'
      ? '/me/sendMail'
      : `/users/${fromMailbox}/sendMail`;
    const message: Record<string, unknown> = {
      subject,
      body: { contentType: 'HTML', content: htmlContent },
      toRecipients: [{ emailAddress: { address: toAddress } }],
    };
    if (ccAddress) {
      message.ccRecipients = [{ emailAddress: { address: ccAddress } }];
    }
    await this.post(path, { message });
  }

  /**
   * Reply to an existing message in a mailbox (DL-266).
   * Two-step: createReply (draft) → send. More reliable than direct /reply.
   * Looks up Graph message ID from Internet Message-ID first.
   */
  async replyToMessage(
    internetMessageId: string,
    htmlContent: string,
    fromMailbox: string = 'me',
  ): Promise<void> {
    // Step 1: Look up Graph ID from Internet Message-ID
    const userPath = fromMailbox === 'me' ? '/me' : `/users/${fromMailbox}`;
    const filter = encodeURIComponent(`internetMessageId eq '${internetMessageId}'`);
    const lookupPath = `${userPath}/messages?$filter=${filter}&$select=id&$top=1`;
    const result = await this.get(lookupPath) as { value?: Array<{ id: string }> };
    if (!result?.value?.[0]?.id) {
      throw new Error(`[ms-graph] Message not found for internetMessageId: ${internetMessageId}`);
    }
    const graphId = result.value[0].id;

    // Step 2: Create draft reply with HTML body
    const draft = await this.post(`${userPath}/messages/${graphId}/createReply`, {
      message: {
        body: { contentType: 'HTML', content: htmlContent },
      },
    }) as { id: string };

    // Step 3: Send the draft
    await this.post(`${userPath}/messages/${draft.id}/send`, undefined);
  }

  async batch(requests: BatchRequest[]): Promise<BatchResponse[]> {
    const token = await getAccessToken(this.env, this.ctx);
    const url = `${GRAPH_BASE}/$batch`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    let response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ requests }),
    });

    // Auto-retry once on 401
    if (response.status === 401) {
      await this.env.TOKEN_CACHE.delete(KV_ACCESS_TOKEN);
      const freshToken = await getAccessToken(this.env, this.ctx);
      headers.Authorization = `Bearer ${freshToken}`;
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ requests }),
      });
    }

    if (!response.ok) {
      let errorDetail = `HTTP ${response.status}`;
      try {
        const errBody = await response.json() as any;
        errorDetail = errBody?.error?.message ?? errorDetail;
      } catch {
        // ignore parse error
      }
      console.error(`[ms-graph] $batch failed: ${errorDetail}`);
      throw new Error(`[ms-graph] $batch failed: ${errorDetail}`);
    }

    const result = await response.json() as { responses: BatchResponse[] };
    return result.responses;
  }

  async batchResolveUrls(
    itemIds: string[]
  ): Promise<Map<string, { webUrl?: string; downloadUrl?: string }>> {
    const requests: BatchRequest[] = itemIds.map((itemId) => ({
      id: itemId,
      method: 'GET',
      url: `/me/drive/items/${itemId}`,
    }));

    const responses = await this.batch(requests);

    const resultMap = new Map<string, { webUrl?: string; downloadUrl?: string }>();

    for (const resp of responses) {
      if (resp.status !== 200) {
        // Partial failure — skip this item
        console.error(`[ms-graph] batchResolveUrls: item ${resp.id} returned status ${resp.status}`);
        continue;
      }

      const body = resp.body as any;
      resultMap.set(resp.id, {
        webUrl: body?.webUrl ?? undefined,
        downloadUrl: body?.['@microsoft.graph.downloadUrl'] ?? undefined,
      });
    }

    return resultMap;
  }
}
