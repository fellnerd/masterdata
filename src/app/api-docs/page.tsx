import { ApiDocsClient } from './ApiDocsClient'

export const metadata = {
  title: 'MDS API Reference',
}

// /api-docs - interactive API reference for /api/v1, reachable without an
// MSAL/session login (see publicRoutes in src/lib/auth.config.ts).
// Authentication for actually calling the API happens inside the page
// itself, via Scalar's "Authorize" dialog and an mds_... API token - not
// via the app's normal session.
export default function ApiDocsPage() {
  return <ApiDocsClient />
}
