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
 *
 * IMPORTANT — output transformation:
 *   Each tool runs the raw Worker/Airtable response through a `formatForChat*`
 *   step before returning to the LLM. This keeps record IDs and English enum
 *   codes out of Haiku's context window, which is the structural defense
 *   against the model leaking them into Hebrew chat replies. The only place
 *   the model sees a `rec…` id is inside the `_internal` field, which the
 *   system prompt explicitly forbids surfacing.
 */

import type {
  AnthropicToolSchema,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from './types';
import type { WorkerApiClient } from './worker-api-client';
import {
  formatDocProgress,
  translateDocStatus,
  translateStage,
} from '../stage-translations';

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

// ─── Chat-shape types (what the LLM sees) ───────────────────────────────────

interface ChatClientSummary {
  display_name: string;
  status_he: string;
  progress_he: string | null;
  is_active: boolean;
  /** Hidden from chat replies — used only for follow-up tool calls. */
  _internal: { record_id: string };
}

interface ChatDashboardStats {
  total_active: number;
  in_review_queue: number;
  by_stage_he: Record<string, number>;
}

interface ChatDocLine {
  issuer_he: string;
  status_he: string;
  /** Hidden — used by future write tools (M2: setDocStatus). */
  _internal: { doc_id: string };
}

interface ChatDocCategory {
  category_he: string;
  docs: ChatDocLine[];
}

interface ChatDocsForClient {
  total_docs: number;
  by_status_he: Record<string, number>;
  groups: Array<{ person: string; categories: ChatDocCategory[] }>;
}

// ─── M1 read-only tools ──────────────────────────────────────────────────────

function getDashboardStatsTool(
  deps: ToolDependencies
): ToolDefinition<{ year?: number; filing_type?: string }> {
  return {
    name: 'get_dashboard_stats',
    description:
      'Get firm-wide dashboard: stage histogram (Hebrew labels) + total active clients + review-queue size. Use when asked for an overview, a count, or "how many clients are in stage X".',
    requiresConfirm: false,
    inputSchema: {
      type: 'object',
      properties: {
        year: {
          type: 'integer',
          description: 'Tax year (e.g. 2024). Defaults to currentYear-1 per system prompt.',
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
      })) as {
        ok?: boolean;
        stats?: Record<string, number>;
        clients?: unknown[];
        review_queue?: unknown[];
        error?: string;
      };
      if (!data?.ok) {
        return { content: `error: ${data?.error ?? 'unknown'}`, isError: true };
      }
      const summary = formatDashboardStats(
        data.stats ?? {},
        Array.isArray(data.review_queue) ? data.review_queue.length : 0
      );
      return { content: JSON.stringify(summary) };
    },
  };
}

function getClientByCpaIdTool(
  deps: ToolDependencies
): ToolDefinition<{ record_id: string }> {
  return {
    name: 'get_client_by_report_id',
    description:
      'Get one client\'s contact details (name, email, cc_email, phone) by Airtable Reports record id. Pass the value from `_internal.record_id` of a previous search result. Never echo `_internal` to the user.',
    requiresConfirm: false,
    inputSchema: {
      type: 'object',
      properties: {
        record_id: {
          type: 'string',
          description: 'Airtable Reports record id from a search result\'s `_internal.record_id`.',
        },
      },
      required: ['record_id'],
    },
    async execute(args, _ctx): Promise<ToolResult> {
      const data = (await deps.api.post(
        '/webhook/admin-update-client',
        { report_id: args.record_id, action: 'get' },
        { withTokenInBody: true }
      )) as { ok?: boolean; client?: Record<string, unknown> | null; error?: string };
      if (!data?.ok) {
        return { content: `error: ${data?.error ?? 'unknown'}`, isError: true };
      }
      const compact = formatClientContact(data.client ?? null);
      return { content: JSON.stringify(compact) };
    },
  };
}

function getClientDocumentsTool(
  deps: ToolDependencies
): ToolDefinition<{ record_id: string }> {
  return {
    name: 'get_client_documents',
    description:
      'List a client\'s documents grouped by category, with each doc\'s Hebrew status. Pass the `_internal.record_id` from a search result. Returns Hebrew status labels — never expose the raw English codes.',
    requiresConfirm: false,
    inputSchema: {
      type: 'object',
      properties: {
        record_id: {
          type: 'string',
          description: 'Airtable Reports record id from a search result\'s `_internal.record_id`.',
        },
      },
      required: ['record_id'],
    },
    async execute(args, _ctx): Promise<ToolResult> {
      const data = (await deps.api.get('/webhook/get-client-documents', {
        report_id: args.record_id,
        mode: 'office',
      })) as {
        ok?: boolean;
        groups?: Array<{
          person?: string;
          categories?: Array<{ name_he?: string; docs?: unknown[] }>;
        }>;
        document_count?: number;
        error?: string;
      };
      if (!data?.ok) {
        return { content: `error: ${data?.error ?? 'unknown'}`, isError: true };
      }
      const compact = formatClientDocuments(data.groups ?? [], data.document_count ?? 0);
      return { content: JSON.stringify(compact) };
    },
  };
}

function searchClientsByNameTool(
  deps: ToolDependencies
): ToolDefinition<{ query: string; year?: number }> {
  return {
    name: 'search_clients_by_name',
    description:
      'Search active clients by name fragment (Hebrew or English). Returns up to 10 matches. Each match has `display_name`, Hebrew `status_he`, Hebrew `progress_he`, plus `_internal.record_id` you must use for follow-up tool calls. Never echo `_internal` to the user — use the Hebrew fields only in chat replies.',
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
          description: 'Tax year filter; defaults to currentYear-1 per system prompt.',
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
      const matches: ChatClientSummary[] = (data.clients ?? [])
        .filter((c) => String(c.name ?? '').toLowerCase().includes(needle))
        .slice(0, 10)
        .map(formatClientSummary);
      return { content: JSON.stringify({ match_count: matches.length, matches }) };
    },
  };
}

// ─── formatForChat helpers (pure) ───────────────────────────────────────────

function formatClientSummary(c: Record<string, unknown>): ChatClientSummary {
  const stage = typeof c.stage === 'string' ? c.stage : '';
  const recordId =
    typeof c.report_id === 'string'
      ? c.report_id
      : typeof c.id === 'string'
        ? c.id
        : '';
  return {
    display_name: String(c.name ?? '').trim() || '(no name)',
    status_he: translateStage(stage),
    progress_he: formatDocProgress(
      typeof c.docs_received === 'number' ? c.docs_received : null,
      typeof c.docs_total === 'number' ? c.docs_total : null
    ),
    is_active: c.is_active !== false,
    _internal: { record_id: recordId },
  };
}

function formatClientContact(client: Record<string, unknown> | null): Record<string, unknown> {
  if (!client) return {};
  // The /admin-update-client action='get' response is already minimal:
  // { name, email, cc_email, phone }. Pass through verbatim — no IDs to strip.
  return {
    display_name: client.name ?? '',
    email: client.email ?? '',
    cc_email: client.cc_email ?? '',
    phone: client.phone ?? '',
  };
}

function formatClientDocuments(
  groups: Array<{
    person?: string;
    categories?: Array<{ name_he?: string; docs?: unknown[] }>;
  }>,
  totalCount: number
): ChatDocsForClient {
  const byStatus: Record<string, number> = {};
  const outGroups = groups.map((g) => ({
    person: String(g.person ?? '').trim() || '',
    categories: (g.categories ?? []).map((cat) => ({
      category_he: String(cat.name_he ?? '').trim() || '(unnamed)',
      docs: (cat.docs ?? []).map((d): ChatDocLine => {
        const dx = d as Record<string, unknown>;
        const statusHe = translateDocStatus(typeof dx.status === 'string' ? dx.status : '');
        byStatus[statusHe] = (byStatus[statusHe] ?? 0) + 1;
        return {
          issuer_he: String(dx.issuer_name ?? '').trim() || '',
          status_he: statusHe,
          _internal: { doc_id: String(dx.id ?? '') },
        };
      }),
    })),
  }));
  return {
    total_docs: totalCount,
    by_status_he: byStatus,
    groups: outGroups,
  };
}

function formatDashboardStats(
  raw: Record<string, number>,
  reviewQueueCount: number
): ChatDashboardStats {
  // Raw shape (per dashboard.ts): { total, stage1..stage8, queued_count, review_queue_count }
  // Translate stage1..stage8 numeric keys to Hebrew labels via the canonical
  // 8-stage pipeline order.
  const STAGE_NUM_TO_CODE: Record<number, string> = {
    1: 'Send_Questionnaire',
    2: 'Waiting_For_Answers',
    3: 'Pending_Approval',
    4: 'Collecting_Docs',
    5: 'Review',
    6: 'Moshe_Review',
    7: 'Before_Signing',
    8: 'Completed',
  };
  const byStageHe: Record<string, number> = {};
  for (let i = 1; i <= 8; i++) {
    const count = typeof raw[`stage${i}`] === 'number' ? raw[`stage${i}`] : 0;
    if (count > 0) byStageHe[translateStage(STAGE_NUM_TO_CODE[i])] = count;
  }
  return {
    total_active: typeof raw.total === 'number' ? raw.total : 0,
    in_review_queue: reviewQueueCount,
    by_stage_he: byStageHe,
  };
}
