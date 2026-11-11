/**
 * Whether GitHub serves a commit from a repository, asked of the host.
 *
 * A CI checkout fetches one pinned revision, detached and shallow, so no
 * remote-tracking branch contains it even though it came from the public
 * repository. The host is the authority on what a reader can open.
 *
 * Returns `{ ok: true }` or `{ ok: false, reason }`. A network error, a rate
 * limit or any unexpected status is a failure with its reason, never a pass.
 */
export async function commitOnHost(repository, revision, {
  fetchImpl = globalThis.fetch,
  env = process.env,
  api = env.LIBTMUX_DOCS_GITHUB_API || 'https://api.github.com',
} = {}) {
  const slug = String(repository ?? '')
    .replace(/^(?:https?:\/\/|git@|ssh:\/\/git@)?github\.com[/:]/, '')
    .replace(/\.git$/, '')
    .replace(/^\/+|\/+$/g, '')
  if (!/^[\w.-]+\/[\w.-]+$/.test(slug)) return { ok: false, reason: `repository ${JSON.stringify(repository)} is not owner/name` }
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'libtmux-docs-check-source-links' }
  const token = env.GITHUB_TOKEN || env.GH_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`
  let res
  try {
    res = await fetchImpl(`${api}/repos/${slug}/commits/${revision}`, { headers, signal: AbortSignal.timeout(20000) })
  } catch (err) {
    return { ok: false, reason: `could not ask GitHub about ${slug}: ${err?.cause?.code ?? err?.message ?? err}` }
  }
  if (res.status === 404 || res.status === 422) return { ok: false, reason: `GitHub has no commit ${revision.slice(0, 8)} in ${slug} (HTTP ${res.status})` }
  if (res.status !== 200) {
    const limited = res.status === 429 || (res.status === 403 && res.headers?.get?.('x-ratelimit-remaining') === '0')
    return { ok: false, reason: `GitHub answered HTTP ${res.status}${limited ? ' (rate limited)' : ''} for ${slug}@${revision.slice(0, 8)}` }
  }
  let body
  try { body = await res.json() } catch { return { ok: false, reason: `GitHub returned unreadable JSON for ${slug}@${revision.slice(0, 8)}` } }
  const want = revision.toLowerCase()
  if (typeof body?.sha !== 'string' || !(body.sha.startsWith(want) || want.startsWith(body.sha))) {
    return { ok: false, reason: `GitHub answered a different commit for ${slug}@${revision.slice(0, 8)}` }
  }
  return { ok: true }
}
