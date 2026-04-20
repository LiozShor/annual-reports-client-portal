import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchClient, updateClient } from '@/lib/apiClient'
import type { ClientDetail, ClientUpdatePayload } from '@/types/client'

export function clientQueryKey(reportId: string) {
  return ['client', reportId] as const
}

export function useClient(reportId: string) {
  return useQuery({
    queryKey: clientQueryKey(reportId),
    queryFn: () => fetchClient(reportId),
    staleTime: 60_000,
  })
}

export function useUpdateClient(reportId: string, onSaved?: (updated: Partial<ClientDetail>) => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: ClientUpdatePayload) => updateClient(payload),
    onMutate: async (payload) => {
      await qc.cancelQueries({ queryKey: clientQueryKey(reportId) })
      const snapshot = qc.getQueryData(clientQueryKey(reportId))
      qc.setQueryData(clientQueryKey(reportId), (old: unknown) => {
        if (!old || typeof old !== 'object') return old
        return { ...old, ...payload }
      })
      return { snapshot }
    },
    onError: (_err, _payload, context) => {
      if (context?.snapshot !== undefined) {
        qc.setQueryData(clientQueryKey(reportId), context.snapshot)
      }
      window.showAIToast('שגיאה בשמירה', 'error')
    },
    onSuccess: (_data, variables) => {
      window.showAIToast('נשמר בהצלחה', 'success')
      onSaved?.(variables)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: clientQueryKey(reportId) })
    },
  })
}
