import { NextResponse } from 'next/server'
import { openApiSpec } from '@/lib/openapi/spec'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/v1/openapi.json - the OpenAPI spec backing /api-docs. Already
// under the public /api/v1 prefix (see publicRoutes in auth.config.ts), so
// no session/token gate needed here - it's just documentation.
export async function GET() {
  return NextResponse.json(openApiSpec)
}
