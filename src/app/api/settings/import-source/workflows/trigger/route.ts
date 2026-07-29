import { NextRequest, NextResponse } from 'next/server'
import { dbQuery } from '@/lib/db-server'
import { logger } from '@/lib/logger'
import { parseGithubRepo } from '@/lib/github'
import { addJob } from '@/lib/queue/queue'
import { auth } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ImportSource {
  git_url: string | null
  git_branch: string
  github_api_token: string | null
}

// POST /api/settings/import-source/workflows/trigger - Manually dispatch a GitHub Actions workflow
// Requires a GitHub API token with `actions:write` (a read-only SSH deploy key
// cannot do this - it only grants git clone/fetch, not GitHub REST API access).
export async function POST(request: NextRequest) {
  logger.info('POST /api/settings/import-source/workflows/trigger')

  try {
    const body = await request.json()
    const { filename } = body

    if (!filename) {
      return NextResponse.json({ error: 'filename is required' }, { status: 400 })
    }

    const configs = await dbQuery<ImportSource>(
      `SELECT git_url, git_branch, github_api_token FROM mds_meta.import_source WHERE name = 'default'`
    )
    const config = configs[0]

    if (!config?.git_url) {
      return NextResponse.json({ error: 'No git repository configured' }, { status: 400 })
    }

    if (!config.github_api_token) {
      return NextResponse.json(
        { error: 'No GitHub API token configured. A read-only deploy key can clone the repo but cannot call the GitHub Actions API - add a token with "actions:write" to trigger workflows.' },
        { status: 400 }
      )
    }

    const repo = parseGithubRepo(config.git_url)
    if (!repo) {
      return NextResponse.json(
        { error: 'Could not determine GitHub owner/repo from git_url (only github.com repos are supported for triggering)' },
        { status: 400 }
      )
    }

    const dispatchUrl = `https://api.github.com/repos/${repo.owner}/${repo.repo}/actions/workflows/${filename}/dispatches`
    const dispatchedAt = new Date().toISOString()

    const res = await fetch(dispatchUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.github_api_token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: config.git_branch }),
    })

    if (res.status === 204) {
      logger.info({ filename, repo }, 'Workflow dispatched successfully')

      // GitHub's dispatch API doesn't return a run ID - queue a job whose
      // handler finds and polls the matching run, so its status shows up
      // (and stays in sync) on the Jobs page instead of vanishing after the
      // fire-and-forget dispatch call.
      const session = await auth()
      const job = await addJob(
        'github-action',
        filename,
        session?.user?.id || 'unknown',
        session?.user?.name || 'Unknown User',
        { workflowFilename: filename, dispatchedAt }
      )

      return NextResponse.json({
        success: true,
        message: `Workflow "${filename}" triggered on branch "${config.git_branch}"`,
        jobId: job.id,
      })
    }

    const errorBody = await res.text()
    logger.error({ status: res.status, errorBody, filename, repo }, 'Failed to dispatch workflow')
    return NextResponse.json(
      { error: `GitHub API returned ${res.status}: ${errorBody}` },
      { status: 502 }
    )
  } catch (error) {
    logger.error({ error }, 'Failed to trigger workflow')
    return NextResponse.json(
      { error: 'Failed to trigger workflow', details: String(error) },
      { status: 500 }
    )
  }
}
