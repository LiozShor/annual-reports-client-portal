/**
 * DL-365 Phase 3 — Dev activity viewer React island.
 *
 * Mount: window.mountActivityViewer(element, props)
 * Unmount: window.unmountActivityViewer(element)
 *
 * Props: { adminToken: string }
 *
 * Flow:
 *   1. DevPasswordGate: POST /webhook/admin-dev-verify → store dev-token in sessionStorage
 *   2. Filters: since/until/event_type/client_id/actor, live-tail toggle
 *   3. Timeline: GET /webhook/admin-dev-activity → show rows
 *   4. PII join: batch POST /webhook/admin-clients-lookup → swap rec IDs for names
 */

import { StrictMode, useState, useEffect, useRef, useCallback } from 'react'
import { createRoot } from 'react-dom/client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActivityEvent {
  ts?: string
  event_type: string
  category: string
  severity?: string
  source?: string
  actor?: string
  client_id?: string
  endpoint?: string
  duration_ms?: number
  status?: number
  details?: Record<string, unknown>
  error?: { message?: string; category?: string }
  request_id?: string
  _source?: 'hot' | 'r2'
}

interface ClientInfo {
  name: string
  email_masked: string
  phone_hash: string
}

interface MountProps {
  adminToken: string
}

interface Filters {
  since: string
  until: string
  event_type: string
  client_id: string
  actor: string
  live: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEV_TOKEN_KEY = 'dev_activity_token'
// Use the Worker base set by shared/endpoints.js (CF_BASE), fall back to absolute URL
const API_PREFIX: string = (typeof window !== 'undefined' && window.API_BASE)
  ? window.API_BASE
  : 'https://annual-reports-api.liozshor1.workers.dev/webhook'
const POLL_INTERVAL_MS = 5000
const CATEGORY_COLORS: Record<string, string> = {
  AUTH: '#6366f1', INBOUND: '#0ea5e9', AI: '#8b5cf6',
  ADMIN: '#f59e0b', CLIENT: '#10b981', EMAIL: '#ec4899',
  WORKFLOW: '#64748b', ERROR: '#ef4444',
}
const SEVERITY_COLORS: Record<string, string> = {
  INFO: '#6b7280', WARN: '#f59e0b', ERROR: '#ef4444', CRITICAL: '#dc2626',
}

function isoNow(): string { return new Date().toISOString() }
function isoHoursAgo(h: number): string { return new Date(Date.now() - h * 60 * 60 * 1000).toISOString() }

// ─── Dev Password Gate ────────────────────────────────────────────────────────

function DevPasswordGate({ adminToken, onAuth }: { adminToken: string; onAuth: (tok: string) => void }) {
  const [pw, setPw] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API_PREFIX}/admin-dev-verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ password: pw }),
      })
      const data = await res.json() as { ok: boolean; dev_token?: string; error?: string }
      if (!res.ok || !data.ok) {
        setError(data.error === 'invalid_password' ? 'Wrong password' : (data.error ?? 'Auth failed'))
        return
      }
      if (data.dev_token) {
        sessionStorage.setItem(DEV_TOKEN_KEY, data.dev_token)
        onAuth(data.dev_token)
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: '80px auto', fontFamily: 'system-ui', padding: 24, border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff' }}>
      <h2 style={{ marginBottom: 4, fontSize: 18, fontWeight: 600, color: '#111827' }}>Dev Activity Viewer</h2>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 20 }}>Enter the dev password to access the activity log.</p>
      <form onSubmit={submit}>
        <input
          type="password"
          value={pw}
          onChange={e => setPw(e.target.value)}
          placeholder="Dev password"
          autoFocus
          style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', marginBottom: 12 }}
        />
        {error && <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 10 }}>{error}</div>}
        <button
          type="submit"
          disabled={loading || !pw}
          style={{ width: '100%', padding: '9px 16px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: loading ? 'wait' : 'pointer', opacity: loading || !pw ? 0.7 : 1 }}
        >
          {loading ? 'Verifying…' : 'Unlock'}
        </button>
      </form>
    </div>
  )
}

// ─── Filter Bar ───────────────────────────────────────────────────────────────

function FilterBar({ filters, onChange }: { filters: Filters; onChange: (f: Partial<Filters>) => void }) {
  const EVENT_TYPES = ['', 'auth_success', 'auth_fail', 'dev_login', 'dev_query', 'dev_lookup',
    'classifications_listed', 'doc_approve', 'doc_reject', 'doc_reassign', 'batch_send',
    'doc_upload', 'inbound_note_saved', 'attachment_classified', 'worker_error',
    'tab_switch', 'batch_send_click', 'reminder_send_click']

  const presets = [
    { label: '1h', since: () => isoHoursAgo(1) },
    { label: '6h', since: () => isoHoursAgo(6) },
    { label: '24h', since: () => isoHoursAgo(24) },
    { label: '7d', since: () => isoHoursAgo(168) },
  ]

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '12px 16px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', alignItems: 'center', fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {presets.map(p => (
          <button key={p.label} onClick={() => onChange({ since: p.since(), until: isoNow() })}
            style={{ padding: '4px 10px', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12 }}>
            {p.label}
          </button>
        ))}
      </div>
      <input type="datetime-local" value={filters.since.slice(0, 16)} onChange={e => onChange({ since: new Date(e.target.value).toISOString() })}
        style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }} />
      <span style={{ color: '#9ca3af' }}>→</span>
      <input type="datetime-local" value={filters.until.slice(0, 16)} onChange={e => onChange({ until: new Date(e.target.value).toISOString() })}
        style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }} />
      <select value={filters.event_type} onChange={e => onChange({ event_type: e.target.value })}
        style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }}>
        {EVENT_TYPES.map(t => <option key={t} value={t}>{t || '— all events —'}</option>)}
      </select>
      <input placeholder="client_id" value={filters.client_id} onChange={e => onChange({ client_id: e.target.value })}
        style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, width: 140 }} />
      <input placeholder="actor" value={filters.actor} onChange={e => onChange({ actor: e.target.value })}
        style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, width: 100 }} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
        <input type="checkbox" checked={filters.live} onChange={e => onChange({ live: e.target.checked })} />
        <span>Live tail (5s)</span>
      </label>
    </div>
  )
}

// ─── Event Row ────────────────────────────────────────────────────────────────

function EventRow({ event, clientInfo }: { event: ActivityEvent; clientInfo?: ClientInfo }) {
  const [expanded, setExpanded] = useState(false)
  const catColor = CATEGORY_COLORS[event.category] ?? '#6b7280'
  const sevColor = SEVERITY_COLORS[event.severity ?? 'INFO'] ?? '#6b7280'
  const isError = event.severity === 'ERROR' || event.severity === 'CRITICAL'

  const ts = event.ts ? new Date(event.ts).toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '?'
  const tsDate = event.ts ? new Date(event.ts).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }) : ''

  const clientLabel = clientInfo?.name
    ? `${clientInfo.name} <${clientInfo.email_masked}>`
    : event.client_id ?? ''

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      style={{
        padding: '8px 16px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer',
        background: isError ? '#fff5f5' : (expanded ? '#f9fafb' : '#fff'),
        fontFamily: 'monospace', fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: '#9ca3af', minWidth: 70 }}>{tsDate} {ts}</span>
        <span style={{ background: catColor + '20', color: catColor, padding: '1px 6px', borderRadius: 4, fontWeight: 600, fontSize: 11 }}>{event.category}</span>
        <span style={{ color: sevColor, fontSize: 11 }}>{event.severity ?? 'INFO'}</span>
        <span style={{ fontWeight: 600, color: '#111827', flex: 1 }}>{event.event_type}</span>
        {event.actor && <span style={{ color: '#6b7280' }}>actor: {event.actor}</span>}
        {clientLabel && <span style={{ color: '#6366f1' }}>{clientLabel}</span>}
        {event._source === 'r2' && <span style={{ background: '#e5e7eb', color: '#6b7280', padding: '1px 5px', borderRadius: 3, fontSize: 10 }}>R2</span>}
        {event.duration_ms !== undefined && <span style={{ color: '#9ca3af' }}>{event.duration_ms}ms</span>}
        {event.status !== undefined && <span style={{ color: isError ? '#ef4444' : '#9ca3af' }}>{event.status}</span>}
      </div>
      {expanded && (
        <pre style={{ marginTop: 8, background: '#1e293b', color: '#e2e8f0', padding: 12, borderRadius: 6, overflow: 'auto', fontSize: 11, lineHeight: 1.5 }}>
          {JSON.stringify(event, null, 2)}
        </pre>
      )}
    </div>
  )
}

// ─── Timeline ────────────────────────────────────────────────────────────────

function Timeline({ events, clientMap }: { events: ActivityEvent[]; clientMap: Map<string, ClientInfo> }) {
  if (events.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontFamily: 'system-ui', fontSize: 14 }}>No events found for the selected filters.</div>
  }
  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      {events.map((evt, i) => (
        <EventRow key={`${evt.ts ?? i}-${evt.event_type}-${i}`} event={evt} clientInfo={evt.client_id ? clientMap.get(evt.client_id) : undefined} />
      ))}
    </div>
  )
}

// ─── Main Viewer ──────────────────────────────────────────────────────────────

function ActivityViewer({ adminToken }: MountProps) {
  const [devToken, setDevToken] = useState<string>(() => sessionStorage.getItem(DEV_TOKEN_KEY) ?? '')
  const [filters, setFilters] = useState<Filters>({
    since: isoHoursAgo(24),
    until: isoNow(),
    event_type: '',
    client_id: '',
    actor: '',
    live: false,
  })
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [clientMap, setClientMap] = useState<Map<string, ClientInfo>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [source, setSource] = useState<string>('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchEvents = useCallback(async (f: Filters, dt: string) => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        since: f.since,
        until: f.until,
        limit: '200',
      })
      if (f.event_type) params.set('event_type', f.event_type)
      if (f.client_id) params.set('client_id', f.client_id)
      if (f.actor) params.set('actor', f.actor)

      const res = await fetch(`${API_PREFIX}/admin-dev-activity?${params}`, {
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'X-Dev-Token': dt,
        },
      })
      if (res.status === 401) {
        sessionStorage.removeItem(DEV_TOKEN_KEY)
        setDevToken('')
        return
      }
      const data = await res.json() as { ok: boolean; events: ActivityEvent[]; source?: string; error?: string }
      if (!data.ok) { setError(data.error ?? 'Query failed'); return }

      const newEvents: ActivityEvent[] = (data.events ?? []).sort((a, b) =>
        new Date(b.ts ?? 0).getTime() - new Date(a.ts ?? 0).getTime()
      )
      setEvents(newEvents)
      setSource(data.source ?? '')

      // Collect unique client_ids and batch-lookup
      const clientIds = [...new Set(newEvents.map(e => e.client_id).filter((id): id is string => !!id))]
      if (clientIds.length > 0) {
        await lookupClients(clientIds, adminToken, dt, setClientMap)
      }
    } catch (e) {
      setError((e as Error).message ?? 'Network error')
    } finally {
      setLoading(false)
    }
  }, [adminToken])

  // Initial fetch + filter change
  useEffect(() => {
    if (!devToken) return
    fetchEvents(filters, devToken)
  }, [filters, devToken, fetchEvents])

  // Live-tail polling
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (!devToken || !filters.live) return

    pollRef.current = setInterval(() => {
      fetchEvents({ ...filters, until: isoNow() }, devToken)
    }, POLL_INTERVAL_MS)

    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [devToken, filters, fetchEvents])

  function updateFilters(partial: Partial<Filters>) {
    setFilters(f => ({ ...f, ...partial }))
  }

  if (!devToken) {
    return <DevPasswordGate adminToken={adminToken} onAuth={setDevToken} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'system-ui', background: '#fff' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#111827' }}>Activity Log</h2>
          {source && <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 8 }}>source: {source}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {loading && <span style={{ fontSize: 12, color: '#9ca3af' }}>Loading…</span>}
          {filters.live && !loading && <span style={{ fontSize: 12, color: '#10b981' }}>● Live</span>}
          <button onClick={() => { setFilters(f => ({ ...f, until: isoNow() })) }}
            style={{ padding: '4px 12px', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12 }}>
            Refresh
          </button>
          <button onClick={() => { sessionStorage.removeItem(DEV_TOKEN_KEY); setDevToken('') }}
            style={{ padding: '4px 12px', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12, color: '#6b7280' }}>
            Lock
          </button>
        </div>
      </div>

      <FilterBar filters={filters} onChange={updateFilters} />

      {/* Summary bar */}
      <div style={{ padding: '6px 16px', borderBottom: '1px solid #f3f4f6', fontSize: 12, color: '#6b7280', display: 'flex', gap: 16 }}>
        <span>{events.length} events</span>
        {events.length > 0 && (
          <>
            {Object.entries(
              events.reduce<Record<string, number>>((acc, e) => { acc[e.category] = (acc[e.category] ?? 0) + 1; return acc }, {})
            ).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([cat, n]) => (
              <span key={cat} style={{ color: CATEGORY_COLORS[cat] ?? '#6b7280' }}>{cat}: {n}</span>
            ))}
          </>
        )}
      </div>

      {error && (
        <div style={{ padding: '8px 16px', background: '#fef2f2', color: '#ef4444', fontSize: 13, borderBottom: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      <Timeline events={events} clientMap={clientMap} />
    </div>
  )
}

// ─── Client lookup helper ─────────────────────────────────────────────────────

async function lookupClients(
  ids: string[],
  adminToken: string,
  devToken: string,
  setClientMap: React.Dispatch<React.SetStateAction<Map<string, ClientInfo>>>
): Promise<void> {
  try {
    const res = await fetch(`${API_PREFIX}/admin-clients-lookup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'X-Dev-Token': devToken,
      },
      body: JSON.stringify({ ids }),
    })
    if (!res.ok) return
    const data = await res.json() as { ok: boolean; clients: Record<string, ClientInfo> }
    if (!data.ok) return
    setClientMap(prev => {
      const next = new Map(prev)
      for (const [id, info] of Object.entries(data.clients)) {
        next.set(id, info)
      }
      return next
    })
  } catch { /* best-effort */ }
}

// ─── Island mount/unmount contract ───────────────────────────────────────────

const rootMap = new WeakMap<HTMLElement, ReturnType<typeof createRoot>>()

window.mountActivityViewer = function (element: HTMLElement, props: MountProps): void {
  const existing = rootMap.get(element)
  if (existing) existing.unmount()

  const root = createRoot(element)
  rootMap.set(element, root)

  root.render(
    <StrictMode>
      <ActivityViewer adminToken={props.adminToken} />
    </StrictMode>
  )
}

window.unmountActivityViewer = function (element: HTMLElement): void {
  const root = rootMap.get(element)
  if (root) {
    root.unmount()
    rootMap.delete(element)
    element.remove()
  }
}
