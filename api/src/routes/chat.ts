import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import type { Env } from '../lib/types';

const chat = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// System prompt — Hebrew data query agent for CPA firm
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are a data analysis assistant for Moshe Atsits CPA firm's tax report management system.
Your role: answer questions about client cases, documents, and pipeline status. Be concise and accurate.

## Output Language Rules
1. ALWAYS respond in Hebrew (עברית). Every word of your response must be in Hebrew.
2. Exception: if the user writes in English, respond in English.
3. Technical terms (API, webhook, stage names) may stay in English within Hebrew text.
4. When presenting tool results, translate all labels to Hebrew.

## Pipeline Stages
Each case is in one of 8 stages:
1. Send_Questionnaire — waiting to send (questionnaire not yet sent to client)
2. Waiting_For_Answers — questionnaire sent, waiting for client to fill it
3. Pending_Approval — questionnaire received, documents not yet sent (requires office action)
4. Collecting_Docs — documents requested, waiting for client to upload
5. Review — all docs received, ready for preparation
6. Moshe_Review — sent for internal review by Moshe
7. Before_Signing — waiting for client signature
8. Completed — report filed with authorities

Hebrew labels for stages (use these in responses):
1=ממתין לשליחה, 2=טרם מילא שאלון, 3=התקבל שאלון טרם נשלחו המסמכים, 4=ממתין למסמכים, 5=מוכן להכנה, 6=מוכן לבדיקה של משה, 7=לפני חתימה, 8=הוגש

## Data Fields
- client_name: client name
- report_id: unique case ID (Airtable record ID)
- year: tax year
- stage: current pipeline stage (one of the 8 above)
- email, phone: client contact info
- has_spouse, spouse_name: spouse details
- docs_total: total required documents
- docs_received: documents received
- docs_missing: documents still missing
- last_reminder_sent_at: last reminder date
- reminder_count: number of reminders sent
- reminder_next_date: next scheduled reminder date
- reminder_suppress: suppression status ('forever' = permanent, 'skip_next' = skip one)
- notes: internal office notes
- filing_type: report type — 'annual_report' (דוח שנתי) or 'capital_statement' (הצהרת הון)
- questionnaire_submitted_at: questionnaire submission date
- docs_sent_at: date documents were requested
- docs_completed_at: date all documents were received

## Response Formatting Rules
- 3+ items → use Markdown **table**
- Important numbers → **bold**
- Client names → wrap in \`<client>NAME::REPORT_ID</client>\` tag. The \`::\` separator is MANDATORY (not | which breaks tables). Example: \`<client>משה כהן::recABC12345678ab</client>\`
- Keep answers short — do not elaborate beyond what is needed
- Dates → DD/MM/YYYY format
- If a value is \`_not_loaded\` → respond in Hebrew: "הנתונים האלה עוד לא נטענו. כדי שאוכל לענות, יש לגשת קודם ללשונית הרלוונטית."
- Out-of-scope questions → respond in Hebrew: "אני עוזר לניתוח נתוני לקוחות בלבד. איך אפשר לעזור בנושא הזה?"
- \`_today\` is provided in context for date calculations

## Write Action Rules (Tools)
When the user requests a data-changing action (stage move, reminder, note):
1. Explain what you are about to do BEFORE calling the tool
2. Use the appropriate tool
3. Confirm success after the action completes

## Available Tools
- \`move_to_stage\` — move a case to a different pipeline stage
- \`send_reminder\` — send a manual reminder to a client about missing documents
- \`add_note\` — add an internal note to a case
- \`suppress_reminder\` — enable or disable automatic reminder suppression
- \`send_questionnaire\` — send questionnaire to client (only for Send_Questionnaire stage)
- \`change_reminder_date\` — change a client's next reminder date
- \`get_client_documents\` — retrieve document details for a client (what's received, missing, needs fix). Read-only tool — no user approval needed, use immediately
- \`send_feedback\` — send a message/feedback to the development team`;

// ---------------------------------------------------------------------------
// Tool definitions — forwarded to Anthropic, also used by frontend
// ---------------------------------------------------------------------------
const CHAT_TOOLS = [
  {
    name: 'move_to_stage',
    description: 'Move a case to a different pipeline stage. Only use when the user explicitly confirms.',
    input_schema: {
      type: 'object',
      properties: {
        report_id: { type: 'string', description: 'Airtable record ID of the case' },
        new_stage: {
          type: 'string',
          enum: [
            'Send_Questionnaire', 'Waiting_For_Answers', 'Pending_Approval',
            'Collecting_Docs', 'Review', 'Moshe_Review', 'Before_Signing', 'Completed',
          ],
          description: 'Target stage',
        },
        reason: { type: 'string', description: 'Brief reason for the stage change (for audit log)' },
      },
      required: ['report_id', 'new_stage', 'reason'],
    },
  },
  {
    name: 'send_reminder',
    description: 'Send a manual reminder to a client about missing documents.',
    input_schema: {
      type: 'object',
      properties: {
        report_id: { type: 'string', description: 'Airtable record ID of the case' },
      },
      required: ['report_id'],
    },
  },
  {
    name: 'add_note',
    description: 'Add an internal note to a client case.',
    input_schema: {
      type: 'object',
      properties: {
        report_id: { type: 'string', description: 'Airtable record ID of the case' },
        note_text: { type: 'string', description: 'Note content' },
      },
      required: ['report_id', 'note_text'],
    },
  },
  {
    name: 'suppress_reminder',
    description: 'Enable or disable automatic reminder suppression for a client.',
    input_schema: {
      type: 'object',
      properties: {
        report_id: { type: 'string', description: 'Airtable record ID of the case' },
        suppress: { type: 'boolean', description: 'true = suppress reminders, false = resume reminders' },
      },
      required: ['report_id', 'suppress'],
    },
  },
  {
    name: 'send_questionnaire',
    description: 'Send a questionnaire to a client via email. Only for clients in Send_Questionnaire stage.',
    input_schema: {
      type: 'object',
      properties: {
        report_id: { type: 'string', description: 'Airtable record ID of the case' },
      },
      required: ['report_id'],
    },
  },
  {
    name: 'change_reminder_date',
    description: 'Change the next scheduled reminder date for a client.',
    input_schema: {
      type: 'object',
      properties: {
        report_id: { type: 'string', description: 'Airtable record ID of the case' },
        new_date: { type: 'string', description: 'New date in YYYY-MM-DD format' },
      },
      required: ['report_id', 'new_date'],
    },
  },
  {
    name: 'get_client_documents',
    description: 'Retrieve document details for a client — what is received, missing, or needs fix. Read-only tool, no user approval needed.',
    input_schema: {
      type: 'object',
      properties: {
        report_id: { type: 'string', description: 'Airtable record ID of the case' },
      },
      required: ['report_id'],
    },
  },
  {
    name: 'send_feedback',
    description: 'Send a message or feedback to the development team via email.',
    input_schema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'Message subject' },
        message: { type: 'string', description: 'Message content' },
      },
      required: ['subject', 'message'],
    },
  },
];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 2048;
const MAX_MESSAGES = 20;
const MAX_CONTEXT_CHARS = 50_000;
const TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// In-memory rate limiter — best-effort, per-isolate (resets on Worker restart)
// ---------------------------------------------------------------------------
interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const rateLimitMap = new Map<string, RateLimitEntry>();

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

function checkRateLimit(tokenHash: string): boolean {
  const now = Date.now();
  const HOUR_MS = 60 * 60 * 1000;
  const LIMIT = 60;

  let entry = rateLimitMap.get(tokenHash);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + HOUR_MS };
    rateLimitMap.set(tokenHash, entry);
  }

  if (entry.count >= LIMIT) return false;
  entry.count++;
  return true;
}

// ---------------------------------------------------------------------------
// Anthropic message types
// ---------------------------------------------------------------------------
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | unknown[];
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

// ---------------------------------------------------------------------------
// POST /webhook/admin-chat
// ---------------------------------------------------------------------------
chat.post('/admin-chat', async (c) => {
  const body = await c.req.json<{
    token?: string;
    messages?: AnthropicMessage[];
    context?: string;
  }>();

  // Auth
  const tokenResult = await verifyToken(body.token || '', c.env.SECRET_KEY);
  if (!tokenResult.valid) {
    return c.json(
      { ok: false, error: 'unauthorized', message_he: 'אין הרשאה. נסה לרענן את הדף.' },
      401,
    );
  }

  // Rate limit
  const tokenHash = await hashToken(body.token || '');
  if (!checkRateLimit(tokenHash)) {
    return c.json(
      { ok: false, error: 'rate_limited', message_he: 'יותר מדי בקשות. חכה רגע ונסה שוב.' },
      429,
    );
  }

  const messages = body.messages || [];
  if (messages.length === 0) {
    return c.json({ ok: false, error: 'no_messages', message_he: 'לא סופקו הודעות.' }, 400);
  }
  if (messages.length > MAX_MESSAGES) {
    return c.json({ ok: false, error: 'too_many_messages', message_he: 'יותר מדי הודעות. נסה שאלה חדשה.' }, 400);
  }

  // Build system prompt (inject context + today's date if provided)
  let systemPrompt = SYSTEM_PROMPT;
  const context = body.context ? body.context.slice(0, MAX_CONTEXT_CHARS) : '';
  if (context) {
    systemPrompt += `\n\n## Context Data\n${context}`;
  }
  systemPrompt += `\n\n_today: ${new Date().toLocaleDateString('he-IL')}`;

  // Build Anthropic request body
  const anthropicBody: Record<string, unknown> = {
    model: ANTHROPIC_MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages,
    tools: CHAT_TOOLS,
  };

  // Forward to Anthropic
  let response: Response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': c.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicBody),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const isTimeout =
      err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    if (isTimeout) {
      return c.json(
        {
          ok: false,
          error: 'upstream_timeout',
          message_he: 'הבקשה לקחה יותר מדי זמן. נסה שאלה קצרה יותר.',
        },
        504,
      );
    }
    console.error('Anthropic fetch error:', err);
    return c.json(
      { ok: false, error: 'network_error', message_he: 'משהו השתבש. נסה שוב.' },
      500,
    );
  }

  // Handle Anthropic error responses
  if (!response.ok) {
    const status = response.status;
    if (status === 429) {
      return c.json(
        { ok: false, error: 'rate_limited_upstream', message_he: 'יותר מדי בקשות. חכה רגע ונסה שוב.' },
        429,
      );
    }
    if (status >= 500) {
      return c.json(
        {
          ok: false,
          error: 'upstream_error',
          message_he: 'שירות הבינה המלאכותית לא זמין כרגע. נסה שוב בעוד דקה.',
        },
        502,
      );
    }
    const errText = await response.text().catch(() => 'unknown');
    console.error('Anthropic API error:', status, errText);
    return c.json(
      { ok: false, error: 'api_error', message_he: 'משהו השתבש. נסה שוב.' },
      500,
    );
  }

  const data = await response.json<{
    content: AnthropicContentBlock[];
    usage: { input_tokens: number; output_tokens: number };
    stop_reason?: string;
  }>();

  return c.json({
    ok: true,
    content: data.content,
    usage: {
      input_tokens: data.usage?.input_tokens ?? 0,
      output_tokens: data.usage?.output_tokens ?? 0,
    },
    stop_reason: data.stop_reason ?? null,
  });
});

export default chat;
