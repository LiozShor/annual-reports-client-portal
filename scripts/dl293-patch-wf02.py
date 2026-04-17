"""
DL-293: Patch WF02 to call /webhook/extract-issuer-names after Upsert Documents.

Adds two nodes:
  1. Code node "Build Issuer Extraction Payload"  — collects upserted docs into the
     batch payload shape the Worker expects.
  2. HTTP Request node "Call Extract Issuer Names" — POSTs to the Cloudflare Worker,
     Continue-on-Fail enabled (won't block the Update Report Stage / email branches
     if the call errors).

Uses the n8n REST API directly to surgically add the nodes + a single connection
chain (Upsert Documents → new Code → new HTTP). Idempotent: re-running detects
the nodes by name and exits without changes.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request
import urllib.error

API_KEY = os.environ['N8N_API_KEY']
API_URL = os.environ['N8N_API_URL'].rstrip('/')
INTERNAL_KEY = os.environ['N8N_INTERNAL_KEY']  # shared with the Worker
WF_ID = 'QqEIWQlRs1oZzEtNxFUcQ'

WORKER_URL = 'https://annual-reports-api.liozshor1.workers.dev/webhook/extract-issuer-names'

PAYLOAD_NODE_NAME = 'Build Issuer Extraction Payload'
HTTP_NODE_NAME = 'Call Extract Issuer Names'

PAYLOAD_JS = r"""// DL-293: Build batch payload for /webhook/extract-issuer-names
// Input: items from Upsert Documents (one per upserted doc record)
// Output: ONE item with { report_record_id, docs: [...] }

const reportRecordId = $('Extract & Map').first().json.report_record_id;
const items = $input.all();

// AR template prefixes that may carry an issuer-bearing free-text context
const ENRICHABLE = /^T(106|806|867|601|501|901|902)/i;

const docs = [];
for (const it of items) {
  const f = it.json || {};
  const docRecordId = f.id || f.record_id || (f.fields && f.fields.id) || '';
  const fields = f.fields || f;
  const templateId = fields.type || '';
  const issuerName = (fields.issuer_name || '').toString().trim();
  if (!docRecordId || !templateId || !issuerName) continue;
  if (!ENRICHABLE.test(templateId)) continue;
  docs.push({
    doc_record_id: docRecordId,
    template_id: templateId,
    raw_context: issuerName,
    person: fields.person || 'client',
    current_issuer_name: issuerName,
    existing_notes: (fields.bookkeepers_notes || '').toString(),
  });
}

return [{
  json: {
    report_record_id: reportRecordId,
    year: $('Extract & Map').first().json.year || '',
    docs,
  }
}];
"""


def http(method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(
        f'{API_URL}/api/v1{path}',
        data=data,
        method=method,
        headers={
            'X-N8N-API-KEY': API_KEY,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        print(f'HTTP {e.code}: {body[:500]}', file=sys.stderr)
        raise


def main() -> None:
    wf = http('GET', f'/workflows/{WF_ID}')
    nodes = wf['nodes']
    connections = wf['connections']

    if any(n['name'] == PAYLOAD_NODE_NAME for n in nodes):
        print(f'[DL-293] {PAYLOAD_NODE_NAME!r} already present — no changes.')
        return

    upsert = next((n for n in nodes if n['name'] == 'Upsert Documents'), None)
    if upsert is None:
        sys.exit('Upsert Documents node not found in WF02')

    base_x, base_y = upsert['position']

    payload_node = {
        'parameters': {'jsCode': PAYLOAD_JS},
        'type': 'n8n-nodes-base.code',
        'typeVersion': 2,
        'position': [base_x + 224, base_y + 96],
        'id': 'dl293-build-payload',
        'name': PAYLOAD_NODE_NAME,
    }

    http_node = {
        'parameters': {
            'method': 'POST',
            'url': WORKER_URL,
            'sendHeaders': True,
            'headerParameters': {
                'parameters': [
                    {'name': 'Authorization', 'value': f'Bearer {INTERNAL_KEY}'},
                    {'name': 'Content-Type', 'value': 'application/json'},
                ],
            },
            'sendBody': True,
            'specifyBody': 'json',
            'jsonBody': '={{ JSON.stringify($json) }}',
            'options': {'timeout': 30000},
        },
        'type': 'n8n-nodes-base.httpRequest',
        'typeVersion': 4.3,
        'position': [base_x + 448, base_y + 96],
        'id': 'dl293-call-extract',
        'name': HTTP_NODE_NAME,
        'onError': 'continueRegularOutput',
        'continueOnFail': True,
        'notes': 'DL-293: Posts batch to extract issuer names. Continue-on-Fail keeps WF02 alive on transient failures.',
    }

    nodes.extend([payload_node, http_node])

    # Wire: Upsert Documents → Build Issuer Extraction Payload → Call Extract Issuer Names
    connections.setdefault('Upsert Documents', {'main': [[]]})
    main = connections['Upsert Documents']['main']
    if not main:
        main.append([])
    main[0].append({'node': PAYLOAD_NODE_NAME, 'type': 'main', 'index': 0})

    connections[PAYLOAD_NODE_NAME] = {
        'main': [[{'node': HTTP_NODE_NAME, 'type': 'main', 'index': 0}]],
    }
    connections[HTTP_NODE_NAME] = {'main': [[]]}

    # n8n public API PUT only accepts a whitelist of settings keys
    ALLOWED_SETTINGS = {
        'saveExecutionProgress', 'saveManualExecutions',
        'saveDataErrorExecution', 'saveDataSuccessExecution',
        'executionTimeout', 'errorWorkflow', 'timezone', 'executionOrder',
    }
    raw_settings = wf.get('settings') or {}
    clean_settings = {k: v for k, v in raw_settings.items() if k in ALLOWED_SETTINGS}

    payload = {
        'name': wf['name'],
        'nodes': nodes,
        'connections': connections,
        'settings': clean_settings,
    }

    http('PUT', f'/workflows/{WF_ID}', payload)
    print(f'[DL-293] WF02 patched: added {PAYLOAD_NODE_NAME!r} + {HTTP_NODE_NAME!r} after Upsert Documents.')


if __name__ == '__main__':
    main()
