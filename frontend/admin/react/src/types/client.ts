export type StageKey =
  | 'Send_Questionnaire'
  | 'Waiting_For_Answers'
  | 'Pending_Approval'
  | 'Collecting_Docs'
  | 'Review'
  | 'Moshe_Review'
  | 'Before_Signing'
  | 'Completed'

export interface ClientDetail {
  reportId: string
  clientName: string
  spouseName: string | null
  email: string
  ccEmail: string | null
  phone: string | null
  stage: StageKey
  filingType: 'AR' | 'CS'
}

export interface ClientUpdatePayload {
  reportId: string
  name?: string
  email?: string
  cc_email?: string | null
  phone?: string | null
}

export type ClientDetailFocusField = 'name' | 'email' | 'cc_email' | 'phone'

export interface ClientDetailContext {
  /** The vanilla JS context object passed from script.js — can be used for callbacks */
  onClose?: () => void
  onSaved?: (updated: Partial<ClientDetail>) => void
  /** DL-366: optionally auto-focus a specific field when the modal opens. */
  focusField?: ClientDetailFocusField
}
