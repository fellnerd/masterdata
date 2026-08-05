/**
 * Health Check API
 * 
 * Used by Docker and load balancers to check application health
 */

import { NextResponse } from 'next/server';
import packageJson from '../../../../package.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // Basic health check. Version comes straight from package.json rather than
  // npm_package_version, which npm only sets when a process is launched via
  // an npm script - the standalone Docker output runs `node server.js`
  // directly, so that env var would always be empty there.
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: packageJson.version,
    buildSha: process.env.NEXT_PUBLIC_BUILD_SHA || 'unknown',
    uptime: process.uptime(),
  };

  return NextResponse.json(health);
}
