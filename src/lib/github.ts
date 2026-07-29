/**
 * Parses owner/repo out of an SSH (git@github.com:owner/repo.git) or
 * HTTPS (https://github.com/owner/repo[.git]) GitHub URL.
 */
export function parseGithubRepo(gitUrl: string): { owner: string; repo: string } | null {
  const sshMatch = gitUrl.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/)
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] }

  const httpsMatch = gitUrl.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/)
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] }

  return null
}
