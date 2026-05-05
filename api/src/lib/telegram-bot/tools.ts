/**
 * DL-402 — tool registry + M1 read-only tool implementations.
 *
 * OCP: adding a tool = appending to `buildToolRegistry`. The loop (`loop.ts`)
 * does NOT branch on tool name; it consults the registry's `requiresConfirm`
 * flag and `execute` function.
 *
 * Each tool's `execute` calls `WorkerApiClient` for HTTP-bound operations or
 * Airtable directly for queries the Worker doesn't expose. No tool reaches
 * for KV, Telegram, or Anthropic — that would violate ISP.
 */

import type {
  AnthropicToolSchema,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from './types';
import type { WorkerApiClient } from './worker-api-client';

export class ToolRegistry {
  private readonly byName: Map<string, ToolDefinition> = new Map();

  add(tool: ToolDefinition): void {
    if (this.byName.has(tool.name)) {
      throw new Error(`tool_already_registered: ${tool.name}`);
    }
    this.byName.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.byName.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.byName.values()];
  }

  /** Anthropic tool schemas — what the LLM sees. */
  toAnthropicSchemas(): AnthropicToolSchema[] {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }
}

// ─── Dependencies passed to every tool factory ──────────────────────────────

export interface ToolDependencies {
  api: WorkerApiClient;
}

// ─── Public factory ──────────────────────────────────────────────────────────

export function buildToolRegistry(deps: ToolDependencies): ToolRegistry {
  const registry = new ToolRegistry();
  registry.add(getDashboardStatsTool(deps));
  registry.add(getClientByCpaIdTool(deps));
  registry.add(getClientDocumentsTool(deps));
  registry.add(searchClientsByNameTool(deps));
  return registry;
}

// ─── M1 read-only tools ──────────────────────────────────────────────────────

function getDashboardStatsTool(deps: ToolDependencies): ToolDefinition<{ year?: number; filing_type?: string }> {
  return {
    name: 'get_dashboard_stats',
    description:
      'Get firm-wide dashboard: stage histogram, total active clients, and review queue size. Use when asked for an overview, a count, or "how many clients are in stage X".',
    requiresConfirm: false,
    inputSchema: {
      type: 'object',
      properties: {
        year: {
          type: 'integer',
          description: 'Tax year (e.g. 2024). Defaults to current year if omitted.',
        },
        filing_type: {
          type: 'string',
          enum: ['annual_report', 'capital_statements'],
          description: 'Filing type. Defaults to annual_report.',
        },
      },
    },
    async execute(args, _ctx): Promise<ToolResult> {
      const data = (await deps.api.get('/webhook/admin-dashboard', {
        year: args.year,
        filing_type: args.filing_type,
      })) as { ok?: boolean; stats?: unknown; clients?: unknown[]; review_queue?: unknown[]; error?: string };
      if (!data?.ok) {
        return { content: `error: ${data?.error ?? 'unknown'}`, isError: true };
      }
      const summary = {
        stats: data.stats,
        client_count: Array.isArray(data.clients) ? data.clients.length : 0,
        review_queue_count: Array.isArray(data.review_queue) ? data.review_queue.length : 0,
      };
      return { content: JSON.stringify(summary) };
    },
  };
}

function getClientByCpaIdTool(deps: ToolDependencies): ToolDefinition<{ report_id: string }> {
  return {
    name: 'get_client_by_report_id',
    description:
      'Get one client\'s contact details (name, email, cc_email, phone) by Airtable report record id (e.g. "rec123…"). If you only have a CPA-ID or name, call search_clients_by_name first.',
    requiresConfirm: false,
    inputSchema: {
      type: 'object',
      properties: {
        report_id: {
          type: 'string',
          description: 'Airtable Reports record id, starts with "rec".',
        },
      },
      required: ['report_id'],
    },
    async execute(args, _ctx): Promise<ToolResult> {
      const data = (await deps.api.post(
        '/webhook/admin-update-client',
        { report_id: args.report_id, action: 'get' },
        { withTokenInBody: true }
      )) as { ok?: boolean; client?: unknown; error?: string };
      if (!data?.ok) {
        return { content: `error: ${data?.error ?? 'unknown'}`, isError: true };
      }
      return { content: JSON.stringify(data.client ?? null) };
    },
  };
}

function getClientDocumentsTool(deps: ToolDependencies): ToolDefinition<{ report_id: string }> {
  return {
    name: 'get_client_documents',
    description:
      'List a client\'s documents grouped by category, with each doc\'s status (Received / Required_Missing / Requires_Fix / Waived). Use to answer "did Cohen send his form 106 yet?" type questions.',
    requiresConfirm: false,
    inputSchema: {
      type: 'object',
      properties: {
        report_id: {
          type: 'string',
          description: 'Airtable Reports record id.',
        },
      },
      required: ['report_id'],
    },
    async execute(args, _ctx): Promise<ToolResult> {
      const data = (await deps.api.get('/webhook/get-client-documents', {
        report_id: args.report_id,
        mode: 'office',
      })) as {
        ok?: boolean;
        groups?: Array<{ person?: string; categories?: Array<{ name_he?: string; docs?: unknown[] }> }>;
        document_count?: number;
        error?: string;
      };
      if (!data?.ok) {
        return { content: `error: ${data?.error ?? 'unknown'}`, isError: true };
      }
      const compact = (data.groups ?? []).map((g) => ({
        person: g.person,
        categories: (g.categories ?? []).map((c) => ({
          name: c.name_he,
          docs: (c.docs ?? []).map((d) => {
            const dx = d as Record<string, unknown>;
            return {
              id: dx.id,
              issuer: dx.issuer_name,
              status: dx.status,
            };
          }),
        })),
      }));
      return { content: JSON.stringify({ document_count: data.document_count, groups: compact }) };
    },
  };
}

function searchClientsByNameTool(
  deps: ToolDependencies
): ToolDefinition<{ query: string; year?: number }> {
  return {
    name: 'search_clients_by_name',
    description:
      'Search active clients by name fragment (Hebrew or English). Returns up to 10 matches with report_id, name, stage, and doc progress. Use when the user mentions a name without a record id.',
    requiresConfirm: false,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Name fragment, case-insensitive. Hebrew and English both accepted.',
        },
        year: {
          type: 'integer',
          description: 'Tax year filter; defaults to current year.',
        },
      },
      required: ['query'],
    },
    async execute(args, _ctx): Promise<ToolResult> {
      const data = (await deps.api.get('/webhook/admin-dashboard', { year: args.year })) as {
        ok?: boolean;
        clients?: Array<Record<string, unknown>>;
        error?: string;
      };
      if (!data?.ok) {
        return { content: `error: ${data?.error ?? 'unknown'}`, isError: true };
      }
      const needle = args.query.trim().toLowerCase();
      const matches = (data.clients ?? [])
        .filter((c) => {
          const name = String(c.name ?? '').toLowerCase();
          return name.includes(needle);
        })
        .slice(0, 10)
        .map((c) => ({
          report_id: c.report_id,
          name: c.name,
          stage: c.stage,
          docs_received: c.docs_received,
          docs_total: c.docs_total,
          is_active: c.is_active,
        }));
      return { content: JSON.stringify({ match_count: matches.length, matches }) };
    },
  };
}
