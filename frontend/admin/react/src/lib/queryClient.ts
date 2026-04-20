import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,      // 60s — client data changes infrequently
      gcTime: 5 * 60_000,    // 5min garbage-collect after unmount
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
})
