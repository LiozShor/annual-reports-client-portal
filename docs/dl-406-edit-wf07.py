"""
DL-406 Phase D-2 — surgical edit of WF07 JSON to add the pending-client-notes
sub-chain inline (no separate sub-workflow). Reads the user's downloaded
WF07 JSON, mutates 1) inserts 6 new nodes after Skip Weekend, 2) shifts
existing nodes right, 3) rewires connections, 4) replaces Build Digest
Email jsCode to render Section 4. Saves a new JSON the user re-imports.
"""
import json
import sys
from pathlib import Path

SRC = Path(r"C:\Users\liozm\Downloads\[07] Daily Natan Digest.json")
OUT = Path(r"C:\Users\liozm\Downloads\[07] Daily Natan Digest - DL-406.json")

with SRC.open("r", encoding="utf-8") as f:
    wf = json.load(f)

# --- Extract existing secrets from the JSON itself (no tool calls carry them) ---
def header_value(node_name, header_name):
    for n in wf["nodes"]:
        if n["name"] == node_name:
            for p in n["parameters"]["headerParameters"]["parameters"]:
                if p["name"] == header_name:
                    return p["value"]
    raise RuntimeError(f"header {header_name} not found on node {node_name}")

PAT = header_value("Query Pending Approval", "Authorization")
ANTHROPIC_KEY = header_value("Call Claude API", "x-api-key")

# --- Build Notes Payload jsCode ---
SYSTEM_PROMPT = (
    "You are a Hebrew triage assistant for a small Israeli CPA firm. You receive an array "
    "of unhandled client notes from the admin dashboard. Bucket each into urgency tiers and "
    "produce a verb-led Hebrew action item per entry.\\n\\n"
    "INPUT shape: { id, client_name, age_hours, summary }\\n\\n"
    "URGENCY RULES (hybrid age + content):\\n"
    "  - urgent: age_hours >= 48 OR summary shows explicit deadline / complaint / "
    "repeated follow-up / financial-or-legal pressure / frustration\\n"
    "  - regular: age_hours < 48 AND routine document submission, question, or status update "
    "(default bucket)\\n"
    "  - fyi: \\u05ea\\u05d5\\u05d3\\u05d4 / \\u05e7\\u05d9\\u05d1\\u05dc\\u05ea\\u05d9 / "
    "auto-confirmations / signature-only / no actionable content\\n\\n"
    "DO NOT FABRICATE: If summary is empty or auto-reply, classify fyi or skip the entry. "
    "NEVER invent context to summarize. The Hebrew word \\u05d3\\u05d7\\u05d5\\u05e3 (urgent) "
    "appearing casually does NOT auto-promote to urgent.\\n\\n"
    "GROUP: same client_name -> ONE entry, count = N notes, ask reflects the most-pressing/latest. "
    "Sort within tier by age_hours desc.\\n\\n"
    "ASK FIELD: verb-led, 1 line Hebrew, action-oriented. "
    "GOOD: \\u05e9\\u05dc\\u05d7 \\u05d8\\u05d5\\u05e4\\u05e1 106, "
    "\\u05d0\\u05e9\\u05e8 \\u05e7\\u05d1\\u05dc\\u05ea \\u05de\\u05e1\\u05de\\u05db\\u05d9\\u05dd, "
    "\\u05dc\\u05d4\\u05d7\\u05d6\\u05d9\\u05e8 \\u05d8\\u05dc\\u05e4\\u05d5\\u05df. "
    "BAD: vague descriptions or passive voice.\\n\\n"
    "OUTPUT JSON ONLY (no markdown fences):\\n"
    "{ \\\"urgent\\\": [ { \\\"client_name\\\": \\\"...\\\", \\\"age_label\\\": \\\"...\\\", "
    "\\\"ask\\\": \\\"...\\\", \\\"count\\\": 1 } ], \\\"regular\\\": [...], \\\"fyi\\\": [...] }\\n\\n"
    "age_label values (Hebrew): \\u05d7\\u05d3\\u05e9, \\u05d9\\u05d5\\u05dd, "
    "\\u05d9\\u05d5\\u05de\\u05d9\\u05d9\\u05dd, \\\"N \\u05d9\\u05de\\u05d9\\u05dd\\\", "
    "\\u05e9\\u05d1\\u05d5\\u05e2+"
)

BUILD_NOTES_JS = """const data = $input.first().json;
const records = data.records || [];
const now = Date.now();
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const allNotes = [];
for (const rec of records) {
  const f = rec.fields || {};
  const clientName = Array.isArray(f.client_name) ? f.client_name[0] : (f.client_name || '');
  const notesRaw = f.client_notes || '';
  if (!notesRaw) continue;
  let notes;
  try { notes = JSON.parse(notesRaw); if (!Array.isArray(notes)) continue; } catch (e) { continue; }
  for (const n of notes) {
    if (n.source !== 'email') continue;
    if (n.hidden_from_dashboard) continue;
    if (n.type === 'office_reply') continue;
    const summary = String(n.summary || n.raw_snippet || '').trim();
    if (!summary) continue;
    const noteDate = new Date(n.date).getTime();
    if (!isFinite(noteDate)) continue;
    const ageMs = now - noteDate;
    if (ageMs > FOURTEEN_DAYS_MS) continue;
    const ageHours = Math.floor(ageMs / (60 * 60 * 1000));
    allNotes.push({ id: n.id || '', client_name: clientName, age_hours: ageHours, summary: summary.substring(0, 500) });
  }
}
allNotes.sort((a, b) => b.age_hours - a.age_hours);
const cappedNotes = allNotes.slice(0, 50);
if (cappedNotes.length === 0) {
  return [{ json: { _hasNotes: false, urgent: [], regular: [], fyi: [], note_count: 0 } }];
}
const systemPrompt = '__SYSTEM_PROMPT__';
const _payload = JSON.stringify({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 2000,
  system: systemPrompt,
  messages: [{ role: 'user', content: 'Bucket these unhandled client notes:\\n\\n' + JSON.stringify(cappedNotes, null, 2) }]
});
return [{ json: { _hasNotes: true, _payload, note_count: cappedNotes.length } }];""".replace("__SYSTEM_PROMPT__", SYSTEM_PROMPT)

PARSE_NOTES_JS = """const item = $input.first().json;
const prep = $('Build Notes Payload').first().json;
if (item.error || !item.content) {
  return [{ json: { error: true, urgent: [], regular: [], fyi: [], note_count: prep.note_count || 0 } }];
}
try {
  let text = (item.content[0] && item.content[0].text) || '';
  let parsed;
  try {
    parsed = JSON.parse(text.trim());
  } catch (firstErr) {
    const m = text.match(/\\{[\\s\\S]*\\}/);
    if (!m) throw firstErr;
    parsed = JSON.parse(m[0]);
  }
  return [{ json: { urgent: parsed.urgent || [], regular: parsed.regular || [], fyi: parsed.fyi || [], note_count: prep.note_count || 0 } }];
} catch (err) {
  return [{ json: { error: true, errorDetail: err.message, urgent: [], regular: [], fyi: [], note_count: prep.note_count || 0 } }];
}"""

RETURN_EMPTY_JS = "return [{ json: { urgent: [], regular: [], fyi: [], note_count: 0 } }];"

# --- New nodes ---
query_pending_notes = {
    "parameters": {
        "url": "https://api.airtable.com/v0/appqBL5RWQN9cPOyh/tbls7m3hmHC4hhQVy",
        "sendQuery": True,
        "queryParameters": {
            "parameters": [
                {"name": "filterByFormula", "value": "AND(NOT(BLANK({client_notes})), IS_AFTER(LAST_MODIFIED_TIME(),DATEADD(NOW(),-30,'days')))"},
                {"name": "pageSize", "value": "100"},
            ]
        },
        "sendHeaders": True,
        "headerParameters": {
            "parameters": [
                {"name": "Authorization", "value": PAT},
            ]
        },
        "options": {},
    },
    "id": "dl406_query_pending_notes",
    "name": "Query Pending Notes",
    "type": "n8n-nodes-base.httpRequest",
    "typeVersion": 4.2,
    "position": [880, 288],
    "alwaysOutputData": True,
}

build_notes_payload = {
    "parameters": {"jsCode": BUILD_NOTES_JS},
    "id": "dl406_build_notes_payload",
    "name": "Build Notes Payload",
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [1104, 288],
}

if_has_pending_notes = {
    "parameters": {
        "conditions": {
            "options": {
                "caseSensitive": True,
                "leftValue": "",
                "typeValidation": "loose",
                "version": 1,
            },
            "conditions": [
                {
                    "id": "dl406_cond_has_notes",
                    "leftValue": "={{ $json._hasNotes }}",
                    "rightValue": "",
                    "operator": {"type": "boolean", "operation": "true"},
                }
            ],
            "combinator": "and",
        },
        "options": {},
    },
    "id": "dl406_if_has_notes",
    "name": "IF Has Pending Notes",
    "type": "n8n-nodes-base.if",
    "typeVersion": 2,
    "position": [1328, 288],
}

call_claude_notes = {
    "parameters": {
        "method": "POST",
        "url": "https://api.anthropic.com/v1/messages",
        "sendHeaders": True,
        "headerParameters": {
            "parameters": [
                {"name": "x-api-key", "value": ANTHROPIC_KEY},
                {"name": "anthropic-version", "value": "2023-06-01"},
            ]
        },
        "sendBody": True,
        "contentType": "raw",
        "rawContentType": "application/json",
        "body": "={{ $json._payload }}",
        "options": {},
    },
    "id": "dl406_call_claude_notes",
    "name": "Call Claude (Notes)",
    "type": "n8n-nodes-base.httpRequest",
    "typeVersion": 4.2,
    "position": [1552, 208],
    "onError": "continueRegularOutput",
}

parse_notes_response = {
    "parameters": {"jsCode": PARSE_NOTES_JS},
    "id": "dl406_parse_notes_response",
    "name": "Parse Notes Response",
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [1776, 208],
}

return_empty_notes = {
    "parameters": {"jsCode": RETURN_EMPTY_JS},
    "id": "dl406_return_empty_notes",
    "name": "Return Empty Notes",
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [1552, 368],
}

# --- Shift positions of existing nodes that came AFTER Skip Weekend ---
NODES_TO_SHIFT = {
    "Query Pending Approval",
    "Query Pending Reviews",
    "Compute Cutoff",
    "Query Inbox Messages",
    "Summarize Inbox (Claude)",
    "IF Has Client Emails",
    "Call Claude API",
    "Parse Claude Response",
    "Build Digest Email",
    "Send Email",
}
SHIFT_X = 1120  # 5 new node-columns × ~224 px

for n in wf["nodes"]:
    if n["name"] in NODES_TO_SHIFT:
        n["position"][0] += SHIFT_X

# --- Append new nodes ---
wf["nodes"].extend([
    query_pending_notes,
    build_notes_payload,
    if_has_pending_notes,
    call_claude_notes,
    parse_notes_response,
    return_empty_notes,
])

# --- Rewire connections ---
# Skip Weekend's TRUE output now goes to Query Pending Notes (was: Query Pending Approval)
wf["connections"]["Skip Weekend"] = {
    "main": [
        [{"node": "Query Pending Notes", "type": "main", "index": 0}]
    ]
}

# New connections in the inserted chain
wf["connections"]["Query Pending Notes"] = {
    "main": [[{"node": "Build Notes Payload", "type": "main", "index": 0}]]
}
wf["connections"]["Build Notes Payload"] = {
    "main": [[{"node": "IF Has Pending Notes", "type": "main", "index": 0}]]
}
wf["connections"]["IF Has Pending Notes"] = {
    "main": [
        [{"node": "Call Claude (Notes)", "type": "main", "index": 0}],   # TRUE
        [{"node": "Return Empty Notes", "type": "main", "index": 0}],     # FALSE
    ]
}
wf["connections"]["Call Claude (Notes)"] = {
    "main": [[{"node": "Parse Notes Response", "type": "main", "index": 0}]]
}
wf["connections"]["Parse Notes Response"] = {
    "main": [[{"node": "Query Pending Approval", "type": "main", "index": 0}]]
}
wf["connections"]["Return Empty Notes"] = {
    "main": [[{"node": "Query Pending Approval", "type": "main", "index": 0}]]
}

# --- Modify Build Digest Email jsCode: add Section 4 + urgent count in subject ---
NEW_BUILD_EMAIL_JS = r"""// Helper: escape HTML special chars in user-generated content
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');
}

// Get all data sources
const approvalData = $('Query Pending Approval').first().json;
const reviewData = $('Query Pending Reviews').first().json;
const claudeData = $input.first().json;

const approvalRecords = (approvalData.records || []).map(r => r.fields);
const reviewRecords = (reviewData.records || []).map(r => r.fields);

const approvalCount = approvalRecords.length;

// Claude output (inbox emails)
const claudeError = claudeData.error === true;
const clientEmails = claudeData.client_emails || [];

// Sort by time descending (latest first)
clientEmails.sort((a, b) => {
  const [aH, aM] = (a.time || '00:00').split(':').map(Number);
  const [bH, bM] = (b.time || '00:00').split(':').map(Number);
  return (bH * 60 + bM) - (aH * 60 + aM);
});

const emailCount = clientEmails.length;

// DL-406: Pending notes from new sub-chain. Only ONE of the two IF-branches ran;
// n8n throws "hasn't been executed" on .first() of the unran node, so try/catch each.
let pendingNotes = { urgent: [], regular: [], fyi: [], note_count: 0 };
try {
  const fromParse = $('Parse Notes Response').first();
  if (fromParse && fromParse.json) pendingNotes = fromParse.json;
} catch (e) {
  try {
    const fromEmpty = $('Return Empty Notes').first();
    if (fromEmpty && fromEmpty.json) pendingNotes = fromEmpty.json;
  } catch (e2) { /* both branches failed — use empty default */ }
}
const urgent = Array.isArray(pendingNotes.urgent) ? pendingNotes.urgent : [];
const regular = Array.isArray(pendingNotes.regular) ? pendingNotes.regular : [];
const fyi = Array.isArray(pendingNotes.fyi) ? pendingNotes.fyi : [];
const notesError = pendingNotes.error === true;
const totalNotes = urgent.length + regular.length + fyi.length;

// Determine recipient by current hour (Israel time)
const israelHour = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem', hour: 'numeric', hour12: false });
const hour = parseInt(israelHour, 10);
const isNatan = hour < 18; // 15:00 = Natan, 20:00 = Moshe
const recipientName = isNatan ? 'נתן' : 'משה';
const recipientEmail = isNatan ? 'natan@moshe-atsits.co.il' : 'moshe@moshe-atsits.co.il';

// Lookback period label
const lookbackHours = $('Compute Cutoff').first().json.lookbackHours || 24;
const lookbackLabel = lookbackHours === 72 ? '3 ימים אחרונים' : '24 שעות אחרונות';

// Section 2 data
const approvalItems = approvalRecords.map(r => {
  const name = Array.isArray(r.client_name) ? r.client_name[0] : (r.client_name || 'ללא שם');
  const isCS = r.filing_type === 'capital_statement';
  return { name, isCS };
});

// Section 3 data
const reviewByClient = {};
for (const r of reviewRecords) {
  const name = r.client_name || 'ללא שם';
  if (!reviewByClient[name]) reviewByClient[name] = 0;
  reviewByClient[name]++;
}
const reviewRows = Object.entries(reviewByClient).map(([name, count]) => ({ name, count }));

const now = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', year: 'numeric' });
// DL-406: emailCount no longer counts toward allEmpty (inbox-emails section is no longer rendered)
const allEmpty = totalNotes === 0 && approvalCount === 0 && reviewRows.length === 0;

const LOGO_URL = 'https://docs.moshe-atsits.com/assets/images/logo.png';

// --- DL-406: helper to render one tier block in Section 4 ---
function renderTierBlock(title, color, emoji, entries) {
  if (!entries || entries.length === 0) return '';
  let html = '<div style="border-right:3px solid ' + color + ';padding:8px 16px 8px 0;margin-bottom:12px">';
  html += '<div style="font-weight:600;color:' + color + ';font-size:14px;margin-bottom:6px">' + emoji + ' ' + title + ' (' + entries.length + ')</div>';
  for (const e of entries) {
    const ageLabel = e.age_label ? ' · ' + esc(e.age_label) : '';
    const countBadge = (e.count && e.count > 1) ? ' <span style="background:#e0e7ff;color:#3730a3;font-size:11px;padding:2px 6px;border-radius:10px;margin-right:6px">(' + e.count + ')</span>' : '';
    html += '<div style="margin-bottom:8px">';
    html += '<strong>' + esc(e.client_name || '') + '</strong>';
    html += '<span style="color:#9ca3af;font-size:13px">' + ageLabel + '</span>' + countBadge;
    html += '<div style="color:#374151;font-size:14px;margin-top:2px">' + esc(e.ask || '') + '</div>';
    html += '</div>';
  }
  html += '</div>';
  return html;
}

// --- Build body HTML ---
let bodyHtml;

if (allEmpty) {
  bodyHtml = '<p style="text-align:center;font-size:18px;color:#059669;padding:24px 0">הכל תקין, אין משימות פתוחות ✓</p>';
} else {
  const sections = [];

  // DL-406 Section 1 (was inbox emails): Pending dashboard messages (urgent first, then regular, then fyi).
  // Inbox-emails sub-chain (Claude-summarized MS Graph) still runs upstream but is not rendered here —
  // the user asked to feature pending-notes at the top. To restore inbox-emails section, paste back
  // the previous Section 1 block above this one.
  if (notesError) {
    let sErr = '<h3 style="margin:0 0 8px;font-size:17px;color:#1a1a1a">📝 הודעות ממתינות מלקוחות</h3>';
    sErr += '<p style="color:#6b7280;font-size:14px">סיווג AI נכשל — בדוק את הוידגט במנהל ידנית</p>';
    sections.push(sErr);
  } else if (totalNotes > 0) {
    let s1 = '<h3 style="margin:0 0 8px;font-size:17px;color:#1a1a1a">📝 הודעות ממתינות מלקוחות (' + totalNotes + ')</h3>';
    s1 += '<p style="margin:0 0 12px;color:#6b7280;font-size:14px">מהוידגט "הודעות אחרונות מלקוחות" — ממוין לפי דחיפות</p>';
    s1 += renderTierBlock('דחוף', '#dc2626', '🔴', urgent);
    s1 += renderTierBlock('רגיל', '#f59e0b', '🟡', regular);
    s1 += renderTierBlock('אינפורמטיבי', '#6b7280', 'ℹ️', fyi);
    sections.push(s1);
  } else {
    let sEmpty = '<h3 style="margin:0 0 8px;font-size:17px;color:#1a1a1a">📝 הודעות ממתינות מלקוחות</h3>';
    sEmpty += '<p style="color:#059669;font-size:14px">אין הודעות ממתינות ✔</p>';
    sections.push(sEmpty);
  }

  // Section 2: Pending Approval
  let s1 = '<h3 style="margin:0 0 8px;font-size:17px;color:#1a1a1a">ממתינים לשליחת המסמכים (' + approvalCount + ')</h3>';
  s1 += '<p style="margin:0 0 12px;color:#6b7280;font-size:14px">הלקוחות האלו מילאו שאלון ומחכים לאישור ושליחת מסמכים</p>';
  if (approvalCount === 0) {
    s1 += '<p style="color:#059669">אין לקוחות ממתינים ✔</p>';
  } else {
    s1 += '<ul style="margin:0 0 0 0;padding:0 20px 0 0;list-style:disc">';
    for (const item of approvalItems) {
      s1 += '<li style="margin-bottom:4px">' + esc(item.name);
      if (item.isCS) s1 += ' <span style="background:#fef3c7;color:#92400e;font-size:11px;padding:2px 6px;border-radius:10px">הצ״ה</span>';
      s1 += '</li>';
    }
    s1 += '</ul>';
  }
  sections.push(s1);

  // Section 3: Pending AI Reviews
  let s2 = '<h3 style="margin:0 0 8px;font-size:17px;color:#1a1a1a">ממתינים לסיווג AI (' + reviewRows.length + ')</h3>';
  s2 += '<p style="margin:0 0 12px;color:#6b7280;font-size:14px">מסמכים שסווגו אוטומטית וצריכים אישור ידני</p>';
  if (reviewRows.length === 0) {
    s2 += '<p style="color:#059669">אין מסמכים ממתינים ✔</p>';
  } else {
    s2 += '<ul style="margin:0 0 0 0;padding:0 20px 0 0;list-style:disc">';
    for (const c of reviewRows) {
      s2 += '<li style="margin-bottom:4px"><strong>' + esc(c.name) + '</strong> — ' + c.count + ' מסמכים</li>';
    }
    s2 += '</ul>';
  }
  sections.push(s2);

  bodyHtml = sections.join('<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">');
}

// --- Subject ---
let subject;
if (allEmpty) {
  subject = 'סיכום יומי — הכל תקין ✓';
} else {
  const parts = [];
  // DL-406: lead with pending-notes urgency counts (no longer leads with inbox-email count)
  if (!notesError && urgent.length > 0) parts.push(urgent.length + ' דחופות');
  if (!notesError && regular.length > 0) parts.push(regular.length + ' רגיל');
  if (approvalCount > 0) parts.push(approvalCount + ' לאישור');
  if (reviewRows.length > 0) parts.push(reviewRows.length + ' לסיווג');
  subject = 'סיכום יומי — ' + parts.join(' · ');
}

// --- Email shell ---
const FONT = "Calibri, -apple-system, 'Segoe UI', Arial, sans-serif";
const ADMIN_URL = 'https://docs.moshe-atsits.com/admin/';

const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f7f8fa">
<tr><td align="center" style="padding:32px 16px">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="max-width:600px;border-radius:8px" dir="rtl">
<tr><td style="padding:24px 32px 16px;text-align:center">
  <img src="${LOGO_URL}" alt="Moshe Atsits" width="180" style="max-width:180px;height:auto" />
</td></tr>
<tr><td style="padding:0 32px 32px;font-family:${FONT};font-size:15px;line-height:1.6;color:#374151">
  <h2 style="margin:0 0 4px;font-size:20px;color:#1a1a1a">סיכום יומי - ${now}</h2>
  <p style="margin:0 0 20px;font-size:14px;color:#9ca3af">שלום ${recipientName},</p>
  ${bodyHtml}
</td></tr>
<tr><td style="padding:0 32px 24px;text-align:center">
  <a href="${ADMIN_URL}" style="max-width:240px;width:100%;display:block;margin:0 auto;padding:12px 32px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px;font-size:16px;font-weight:bold;font-family:${FONT};text-align:center;box-sizing:border-box">פתח פאנל ניהול</a>
</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #e5e7eb;text-align:center">
  <p style="margin:0;font-size:14px;color:#9ca3af;font-family:${FONT}">דוח אוטומטי — מערכת דוחות</p>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>`;

return [{ json: { subject, html, to: recipientEmail } }];
"""

for n in wf["nodes"]:
    if n["name"] == "Build Digest Email":
        n["parameters"]["jsCode"] = NEW_BUILD_EMAIL_JS

# --- Save ---
with OUT.open("w", encoding="utf-8") as f:
    json.dump(wf, f, indent=2, ensure_ascii=False)

print(f"OK: wrote {OUT}")
print(f"Total nodes: {len(wf['nodes'])} (was 13, +6 new = 19)")
print(f"PAT length: {len(PAT)}")
print(f"ANTHROPIC_KEY length: {len(ANTHROPIC_KEY)}")
