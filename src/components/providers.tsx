'use client'

import { OverlaysProvider } from '@blueprintjs/core'
import { ThemeProvider } from '@/lib/theme-provider'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SessionProvider } from 'next-auth/react'
import { useState } from 'react'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000, // 1 minute
        retry: 1,
      },
    },
  }))

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <OverlaysProvider>
            {children}
          </OverlaysProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SessionProvider>
  )
}
