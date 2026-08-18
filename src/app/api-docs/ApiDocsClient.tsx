'use client'

import dynamic from 'next/dynamic'
import '@scalar/api-reference-react/style.css'

// Scalar's React wrapper isn't SSR-safe - load it client-only.
const ApiReferenceReact = dynamic(
  () => import('@scalar/api-reference-react').then((mod) => mod.ApiReferenceReact),
  { ssr: false }
)

export function ApiDocsClient() {
  return (
    <ApiReferenceReact
      configuration={{
        url: '/api/v1/openapi.json',
        theme: 'default',
      }}
    />
  )
}
