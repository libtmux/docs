import { execFileSync } from 'node:child_process'
import { basename, dirname, resolve } from 'node:path'

/**
 * The commit that last touched a file, or null when git cannot answer.
 *
 * `filePath` is what the content loader reports for an entry: relative to
 * `root`, the Astro project directory. It is resolved against `root`, never
 * the process's directory, so the answer does not depend on where the build
 * started. git then runs in the file's own directory.
 *
 * Absence is not staleness: an export tarball, a file that is staged but not
 * yet committed, or a shallow checkout that stops before the file's last
 * change all leave no answer, and none of those means the translation
 * drifted. Callers treat null as "cannot tell" and leave the page in its
 * declared state.
 *
 * A shallow checkout does not answer with nothing. Git cannot see below its
 * boundary, so for a file untouched within the fetched history it names the
 * boundary commit (HEAD in a depth-1 clone), which would read every
 * translation as stale. That commit has no parent here; a commit with a parent
 * did change the file.
 */
export function lastCommitOf(filePath: string, root: string): string | null {
  if (!filePath) return null
  const file = resolve(root, filePath)
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: dirname(file),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  try {
    const [sha, ...parents] = git('log', '-1', '--format=%H %P', '--', basename(file)).split(' ')
    if (!sha) return null
    if (parents.length === 0 && git('rev-parse', '--is-shallow-repository') === 'true') return null
    return sha
  } catch {
    return null
  }
}
