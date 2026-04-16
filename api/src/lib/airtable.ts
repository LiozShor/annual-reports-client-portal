/**
 * Typed Airtable REST API client for Cloudflare Workers.
 * Used by auth routes for security logging (createRecords),
 * and ready for Phase 2 dashboard/client endpoints.
 */

const AIRTABLE_API = 'https://api.airtable.com/v0';

export interface AirtableRecord<T = Record<string, unknown>> {
  id: string;
  fields: T;
  createdTime?: string;
}

export interface AirtableListResponse<T = Record<string, unknown>> {
  records: AirtableRecord<T>[];
  offset?: string;
}

export interface ListOptions {
  filterByFormula?: string;
  fields?: string[];
  sort?: { field: string; direction?: 'asc' | 'desc' }[];
  maxRecords?: number;
  pageSize?: number;
  offset?: string;
}

export class AirtableClient {
  private baseId: string;
  private pat: string;

  constructor(baseId: string, pat: string) {
    this.baseId = baseId;
    this.pat = pat;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.pat}`,
      'Content-Type': 'application/json',
    };
  }

  private url(table: string, recordId?: string): string {
    const base = `${AIRTABLE_API}/${this.baseId}/${encodeURIComponent(table)}`;
    return recordId ? `${base}/${recordId}` : base;
  }

  async listRecords<T = Record<string, unknown>>(
    table: string,
    options?: ListOptions
  ): Promise<AirtableListResponse<T>> {
    const params = new URLSearchParams();
    if (options?.filterByFormula) params.set('filterByFormula', options.filterByFormula);
    if (options?.fields) options.fields.forEach(f => params.append('fields[]', f));
    if (options?.sort) {
      options.sort.forEach((s, i) => {
        params.set(`sort[${i}][field]`, s.field);
        if (s.direction) params.set(`sort[${i}][direction]`, s.direction);
      });
    }
    if (options?.maxRecords) params.set('maxRecords', String(options.maxRecords));
    if (options?.pageSize) params.set('pageSize', String(options.pageSize));
    if (options?.offset) params.set('offset', options.offset);

    const qs = params.toString();
    const res = await fetch(`${this.url(table)}${qs ? '?' + qs : ''}`, {
      headers: this.headers,
    });

    if (!res.ok) {
      throw new Error(`Airtable listRecords error: ${res.status} ${await res.text()}`);
    }

    return res.json() as Promise<AirtableListResponse<T>>;
  }

  /** Fetch all records across pages (follows offset pagination). */
  async listAllRecords<T = Record<string, unknown>>(
    table: string,
    options?: Omit<ListOptions, 'offset'>
  ): Promise<AirtableRecord<T>[]> {
    const all: AirtableRecord<T>[] = [];
    let offset: string | undefined;
    do {
      const page = await this.listRecords<T>(table, { ...options, offset });
      all.push(...page.records);
      offset = page.offset;
    } while (offset);
    return all;
  }

  async getRecord<T = Record<string, unknown>>(
    table: string,
    recordId: string
  ): Promise<AirtableRecord<T>> {
    const res = await fetch(this.url(table, recordId), {
      headers: this.headers,
    });

    if (!res.ok) {
      throw new Error(`Airtable getRecord error: ${res.status} ${await res.text()}`);
    }

    return res.json() as Promise<AirtableRecord<T>>;
  }

  async updateRecord(
    table: string,
    recordId: string,
    fields: Record<string, unknown>
  ): Promise<AirtableRecord> {
    const res = await fetch(this.url(table, recordId), {
      method: 'PATCH',
      headers: this.headers,
      body: JSON.stringify({ fields }),
    });

    if (!res.ok) {
      throw new Error(`Airtable updateRecord error: ${res.status} ${await res.text()}`);
    }

    return res.json() as Promise<AirtableRecord>;
  }

  async createRecords(
    table: string,
    records: { fields: Record<string, unknown> }[],
    opts: { typecast?: boolean } = {}
  ): Promise<AirtableRecord[]> {
    const body: Record<string, unknown> = { records };
    if (opts.typecast) body.typecast = true;
    const res = await fetch(this.url(table), {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Airtable createRecords error: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as { records: AirtableRecord[] };
    return data.records;
  }

  /** Batch update records in chunks of 10 (Airtable limit). */
  async batchUpdate(
    table: string,
    records: { id: string; fields: Record<string, unknown> }[]
  ): Promise<AirtableRecord[]> {
    const all: AirtableRecord[] = [];
    for (let i = 0; i < records.length; i += 10) {
      const chunk = records.slice(i, i + 10);
      const res = await fetch(this.url(table), {
        method: 'PATCH',
        headers: this.headers,
        body: JSON.stringify({ records: chunk }),
      });

      if (!res.ok) {
        throw new Error(`Airtable batchUpdate error: ${res.status} ${await res.text()}`);
      }

      const data = (await res.json()) as { records: AirtableRecord[] };
      all.push(...data.records);
    }
    return all;
  }

  /** Batch create records in chunks of 10 (Airtable limit). */
  async batchCreate(
    table: string,
    records: { fields: Record<string, unknown> }[]
  ): Promise<{ created: AirtableRecord[]; errors: string[] }> {
    const created: AirtableRecord[] = [];
    const errors: string[] = [];
    for (let i = 0; i < records.length; i += 10) {
      const chunk = records.slice(i, i + 10);
      try {
        const result = await this.createRecords(table, chunk);
        created.push(...result);
      } catch (e) {
        errors.push(`Batch ${Math.floor(i / 10)}: ${(e as Error).message}`);
      }
    }
    return { created, errors };
  }

  /** Upsert records using performUpsert (match on fieldsToMergeOn). Chunks of 10. */
  async upsertRecords(
    table: string,
    records: { fields: Record<string, unknown> }[],
    fieldsToMergeOn: string[]
  ): Promise<AirtableRecord[]> {
    const all: AirtableRecord[] = [];
    for (let i = 0; i < records.length; i += 10) {
      const chunk = records.slice(i, i + 10);
      const res = await fetch(this.url(table), {
        method: 'PATCH',
        headers: this.headers,
        body: JSON.stringify({
          records: chunk,
          performUpsert: { fieldsToMergeOn },
        }),
      });
      if (!res.ok) {
        throw new Error(`Airtable upsertRecords error: ${res.status} ${await res.text()}`);
      }
      const data = (await res.json()) as { records: AirtableRecord[] };
      all.push(...data.records);
    }
    return all;
  }

  /** Batch delete records in chunks of 10 (Airtable limit). */
  async deleteRecords(table: string, ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += 10) {
      const chunk = ids.slice(i, i + 10);
      const params = chunk.map((id) => `records[]=${id}`).join('&');
      const res = await fetch(`${this.url(table)}?${params}`, {
        method: 'DELETE',
        headers: this.headers,
      });
      if (!res.ok) {
        throw new Error(`Airtable deleteRecords error: ${res.status} ${await res.text()}`);
      }
    }
  }
}
