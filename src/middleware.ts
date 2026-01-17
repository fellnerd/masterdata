import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Internal API secret for worker-to-api communication
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'mds-worker-secret-dev';

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Allow internal worker callbacks with API secret
  if (pathname.startsWith('/api/internal/') || 
      (request.method === 'PUT' && pathname === '/api/deploy/schema') ||
      (request.method === 'POST' && pathname === '/api/deploy/data/status')) {
    const apiSecret = request.headers.get('x-internal-secret');
    if (apiSecret === INTERNAL_API_SECRET) {
      return NextResponse.next();
    }
  }
  
  // Use NextAuth for all other routes
  return auth(request as any);
}

// Configure which routes should be protected
export const config = {
  // Protect all routes except static files and public paths
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
};
