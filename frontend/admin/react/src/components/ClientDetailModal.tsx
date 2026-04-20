import { useState, useEffect } from 'react'
import { useClient, useUpdateClient } from '@/hooks/useClient'
import type { ClientDetail } from '@/types/client'

interface Props {
  reportId: string
  onClose: () => void
  onSaved?: (updated: Partial<ClientDetail>) => void
}

interface DraftState {
  email: string
  ccEmail: string
  phone: string
}

function toDraft(client: ClientDetail): DraftState {
  return {
    email: client.email,
    ccEmail: client.ccEmail ?? '',
    phone: client.phone ?? '',
  }
}

function isDirtyCheck(draft: DraftState, client: ClientDetail): boolean {
  return (
    draft.email !== client.email ||
    draft.ccEmail !== (client.ccEmail ?? '') ||
    draft.phone !== (client.phone ?? '')
  )
}

export function ClientDetailModal({ reportId, onClose, onSaved }: Props) {
  const { data: client, isLoading, isError, error } = useClient(reportId)
  const { mutate, isPending } = useUpdateClient(reportId, onSaved)
  const [draft, setDraft] = useState<DraftState | null>(null)

  // Sync draft when data first loads (don't overwrite user edits on refetch)
  useEffect(() => {
    if (client && draft === null) {
      setDraft(toDraft(client))
    }
  }, [client, draft])

  const isDirty = draft !== null && client !== undefined ? isDirtyCheck(draft, client) : false

  function handleClose() {
    if (isDirty) {
      window.showConfirmDialog(
        'יש שינויים שלא נשמרו. לסגור בלי לשמור?',
        onClose,
        'סגור בלי לשמור',
        true
      )
    } else {
      onClose()
    }
  }

  function handleSave() {
    if (!draft || !client) return
    mutate({
      reportId,
      email: draft.email !== client.email ? draft.email : undefined,
      cc_email: draft.ccEmail !== (client.ccEmail ?? '') ? (draft.ccEmail || null) : undefined,
      phone: draft.phone !== (client.phone ?? '') ? (draft.phone || null) : undefined,
    })
  }

  if (isLoading) {
    return (
      <div className="ai-modal-overlay">
        <div className="ai-modal-panel">
          <p className="ai-modal-loading">טוען פרטי לקוח...</p>
        </div>
      </div>
    )
  }

  if (isError || !client) {
    return (
      <div className="ai-modal-overlay">
        <div className="ai-modal-panel">
          <p className="ai-modal-error">
            שגיאה בטעינת פרטים: {error instanceof Error ? error.message : 'שגיאה לא ידועה'}
          </p>
          <button className="btn btn-secondary" onClick={onClose}>
            סגור
          </button>
        </div>
      </div>
    )
  }

  // draft is guaranteed non-null here because useEffect set it when client loaded
  if (!draft) return null

  return (
    <div
      className="ai-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose()
      }}
    >
      <div
        className="ai-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label="עריכת פרטי לקוח"
      >
        <div className="ai-modal-header">
          <h2 className="ai-modal-title">
            {client.clientName}
            {client.spouseName ? ` / ${client.spouseName}` : ''}
          </h2>
          <button className="ai-modal-close" onClick={handleClose} aria-label="סגור">
            ✕
          </button>
        </div>

        <div className="ai-modal-body">
          <div className="form-group">
            <label className="form-label" htmlFor="cd-email">
              אימייל
            </label>
            <input
              id="cd-email"
              type="email"
              className="form-input"
              value={draft.email}
              onChange={(e) => setDraft((d) => (d ? { ...d, email: e.target.value } : d))}
              disabled={isPending}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="cd-cc-email">
              CC אימייל
            </label>
            <input
              id="cd-cc-email"
              type="email"
              className="form-input"
              value={draft.ccEmail}
              onChange={(e) => setDraft((d) => (d ? { ...d, ccEmail: e.target.value } : d))}
              disabled={isPending}
              placeholder="אופציונלי"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="cd-phone">
              טלפון
            </label>
            <input
              id="cd-phone"
              type="tel"
              className="form-input"
              value={draft.phone}
              onChange={(e) => setDraft((d) => (d ? { ...d, phone: e.target.value } : d))}
              disabled={isPending}
              placeholder="אופציונלי"
            />
          </div>
        </div>

        <div className="ai-modal-footer">
          <button className="btn btn-secondary" onClick={handleClose} disabled={isPending}>
            ביטול
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={isPending || !isDirty}
          >
            {isPending ? 'שומר...' : 'שמור'}
          </button>
        </div>
      </div>
    </div>
  )
}
