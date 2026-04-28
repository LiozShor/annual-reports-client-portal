import { useState, useEffect, useRef } from 'react'
import { useClient, useUpdateClient } from '@/hooks/useClient'
import type { ClientDetail, ClientDetailFocusField } from '@/types/client'

interface Props {
  reportId: string
  onClose: () => void
  onSaved?: (updated: Partial<ClientDetail>) => void
  /** DL-366: when set, the matching input is focused + scrolled into view on mount. */
  focusField?: ClientDetailFocusField
}

const FOCUS_FIELD_TO_INPUT_ID: Record<ClientDetailFocusField, string> = {
  name: 'cd-name',
  email: 'cd-email',
  cc_email: 'cd-cc-email',
  phone: 'cd-phone',
}

interface DraftState {
  name: string
  email: string
  ccEmail: string
  phone: string
}

function toDraft(client: ClientDetail): DraftState {
  return {
    name: client.clientName,
    email: client.email,
    ccEmail: client.ccEmail ?? '',
    phone: client.phone ?? '',
  }
}

function isDirtyCheck(draft: DraftState, client: ClientDetail): boolean {
  return (
    draft.name !== client.clientName ||
    draft.email !== client.email ||
    draft.ccEmail !== (client.ccEmail ?? '') ||
    draft.phone !== (client.phone ?? '')
  )
}

function IconUser() {
  return (
    <svg className="client-detail-field-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  )
}

function IconMail() {
  return (
    <svg className="client-detail-field-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7l9 6 9-6M3 7v10a2 2 0 002 2h14a2 2 0 002-2V7M3 7a2 2 0 012-2h14a2 2 0 012 2"/>
    </svg>
  )
}

function IconPhone() {
  return (
    <svg className="client-detail-field-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.67A2 2 0 012 .82h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
    </svg>
  )
}

export function ClientDetailModal({ reportId, onClose, onSaved, focusField }: Props) {
  const { data: client, isLoading, isError, error } = useClient(reportId)
  const { mutate, isPending } = useUpdateClient(reportId, onSaved)
  const [draft, setDraft] = useState<DraftState | null>(null)
  const focusedRef = useRef(false)

  useEffect(() => {
    if (client && draft === null) {
      setDraft(toDraft(client))
    }
  }, [client, draft])

  // DL-366: auto-focus + scroll the requested field once the form is rendered.
  useEffect(() => {
    if (!focusField || focusedRef.current || !draft) return
    const inputId = FOCUS_FIELD_TO_INPUT_ID[focusField]
    const el = document.getElementById(inputId) as HTMLInputElement | null
    if (el) {
      el.focus()
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      focusedRef.current = true
    }
  }, [focusField, draft])

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

  function handleSave(e?: React.FormEvent) {
    e?.preventDefault()
    if (!draft || !client) return
    mutate({
      reportId,
      name: draft.name !== client.clientName ? draft.name : undefined,
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
            <span className="ai-modal-title-action">עריכת לקוח:</span>{' '}
            <span className="ai-modal-title-name">{client.clientName || '—'}</span>
          </h2>
          <button className="ai-modal-close" onClick={handleClose} aria-label="סגור">
            ✕
          </button>
        </div>

        <form className="ai-modal-body" onSubmit={handleSave}>
          <div className="form-group">
            <label className="form-label" htmlFor="cd-name">
              <IconUser />
              שם מלא
            </label>
            <input
              id="cd-name"
              type="text"
              className="form-input"
              value={draft.name}
              onChange={(e) => setDraft((d) => (d ? { ...d, name: e.target.value } : d))}
              disabled={isPending}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="cd-email">
              <IconMail />
              אימייל
            </label>
            <input
              id="cd-email"
              type="email"
              dir="ltr"
              className="form-input"
              value={draft.email}
              onChange={(e) => setDraft((d) => (d ? { ...d, email: e.target.value } : d))}
              disabled={isPending}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="cd-cc-email">
              <IconMail />
              CC אימייל
            </label>
            <input
              id="cd-cc-email"
              type="email"
              dir="ltr"
              className="form-input"
              value={draft.ccEmail}
              onChange={(e) => setDraft((d) => (d ? { ...d, ccEmail: e.target.value } : d))}
              disabled={isPending}
              placeholder="הוסף אימייל נוסף (לבן/בת זוג, יקבל עותק)"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="cd-phone">
              <IconPhone />
              טלפון
            </label>
            <input
              id="cd-phone"
              type="tel"
              dir="ltr"
              className="form-input"
              value={draft.phone}
              onChange={(e) => setDraft((d) => (d ? { ...d, phone: e.target.value } : d))}
              disabled={isPending}
              placeholder="אופציונלי"
            />
          </div>

          {/* hidden submit so Enter key triggers form submit */}
          <button type="submit" style={{ display: 'none' }} />
        </form>

        <div className="ai-modal-footer">
          <button
            className="btn btn-primary"
            onClick={() => handleSave()}
            disabled={isPending || !isDirty}
          >
            {isPending ? 'שומר...' : 'שמור'}
          </button>
          <button className="btn btn-secondary" onClick={handleClose} disabled={isPending}>
            ביטול
          </button>
        </div>
      </div>
    </div>
  )
}
