import type { ClientDetail, ClientUpdatePayload } from '@/types/client'

function getToken(): string {
  return localStorage.getItem(window.ADMIN_TOKEN_KEY) ?? ''
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`API ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

export async function fetchClient(reportId: string): Promise<ClientDetail> {
  const data = await apiFetch<{ reports: ClientDetail[] }>(
    `${window.API_BASE}/get-client-reports?report_id=${encodeURIComponent(reportId)}`
  )
  const report = data.reports[0]
  if (!report) throw new Error(`No client found for reportId ${reportId}`)
  return report
}

export async function updateClient(payload: ClientUpdatePayload): Promise<void> {
  await apiFetch<unknown>(window.ENDPOINTS.adminUpdateClient, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
