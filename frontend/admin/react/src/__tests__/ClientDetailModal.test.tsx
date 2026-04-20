import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientDetailModal } from '@/components/ClientDetailModal'
import type { ClientDetail } from '@/types/client'

vi.mock('@/hooks/useClient')

import { useClient, useUpdateClient } from '@/hooks/useClient'

const mockClient: ClientDetail = {
  reportId: 'R001',
  clientName: 'ישראל ישראלי',
  spouseName: null,
  email: 'israel@test.com',
  ccEmail: null,
  phone: '050-1234567',
  stage: 'Collecting_Docs' as const,
  filingType: 'AR' as const,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ClientDetailModal', () => {
  it('renders client name and form fields from query data', async () => {
    vi.mocked(useClient).mockReturnValue({
      data: mockClient,
      isLoading: false,
      isError: false,
      error: null,
    } as ReturnType<typeof useClient>)

    vi.mocked(useUpdateClient).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateClient>)

    render(<ClientDetailModal reportId="R001" onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('ישראל ישראלי')).toBeInTheDocument()
    })

    const emailInput = screen.getByLabelText('אימייל') as HTMLInputElement
    expect(emailInput.value).toBe('israel@test.com')

    const phoneInput = screen.getByLabelText('טלפון') as HTMLInputElement
    expect(phoneInput.value).toBe('050-1234567')
  })

  it('typing a new email and clicking save fires mutation with correct payload', async () => {
    const mockMutate = vi.fn()

    vi.mocked(useClient).mockReturnValue({
      data: mockClient,
      isLoading: false,
      isError: false,
      error: null,
    } as ReturnType<typeof useClient>)

    vi.mocked(useUpdateClient).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateClient>)

    const user = userEvent.setup()
    render(<ClientDetailModal reportId="R001" onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByLabelText('אימייל')).toBeInTheDocument()
    })

    const emailInput = screen.getByLabelText('אימייל')
    await user.clear(emailInput)
    await user.type(emailInput, 'new@test.com')

    const saveButton = screen.getByRole('button', { name: 'שמור' })
    await user.click(saveButton)

    expect(mockMutate).toHaveBeenCalledWith({
      reportId: 'R001',
      email: 'new@test.com',
      cc_email: undefined,
      phone: undefined,
    })
  })

  it('closing with dirty state calls window.showConfirmDialog', async () => {
    vi.mocked(useClient).mockReturnValue({
      data: mockClient,
      isLoading: false,
      isError: false,
      error: null,
    } as ReturnType<typeof useClient>)

    vi.mocked(useUpdateClient).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateClient>)

    const user = userEvent.setup()
    render(<ClientDetailModal reportId="R001" onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByLabelText('אימייל')).toBeInTheDocument()
    })

    const emailInput = screen.getByLabelText('אימייל')
    await user.type(emailInput, 'x')

    const closeButton = screen.getByRole('button', { name: 'סגור' })
    await user.click(closeButton)

    expect(vi.mocked(window.showConfirmDialog).mock.calls.length).toBeGreaterThan(0)
  })
})
