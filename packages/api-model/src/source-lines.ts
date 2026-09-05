/**
 * Where a line at one commit sits at another.
 *
 * A source link has to name a commit a reader can open, and the commit the
 * model is generated from often is not one: several ports are extracted from
 * a `-docs` worktree whose head exists only on a private fork, so the blob
 * URL 404s. The newest public ancestor — `git merge-base HEAD origin/HEAD` —
 * is openable, but its line numbers are the ancestor's, and pointing a
 * reader at a line the declaration has since moved off is worse than the
 * 404: it is confidently wrong, and nothing in a rendered page shows it.
 *
 * So the line is translated rather than reused. `git diff -U0` between the
 * two commits says exactly which ranges moved and by how much, which is
 * enough to carry a declaration's line back to the ancestor whenever the
 * declaration itself did not change — the common case, since a docs branch
 * edits comments.
 *
 * Pure and diff-text-in, so it is tested without a repository.
 */

export interface Hunk {
  /** First line of the range in the "from" file. */
  oldStart: number
  /** How many lines it covers there; 0 for a pure insertion. */
  oldLines: number
  /** First line of the range in the "to" file. */
  newStart: number
  /** How many lines it covers there; 0 for a pure deletion. */
  newLines: number
}

/** `@@ -a,b +c,d @@`, where an omitted count means one line. */
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm

export function parseHunks(diff: string): Hunk[] {
  const hunks: Hunk[] = []
  for (const m of diff.matchAll(HUNK)) {
    hunks.push({
      oldStart: Number(m[1]),
      oldLines: m[2] === undefined ? 1 : Number(m[2]),
      newStart: Number(m[3]),
      newLines: m[4] === undefined ? 1 : Number(m[4]),
    })
  }
  return hunks
}

/**
 * A line in the "to" file, as a line in the "from" file.
 *
 * Returns null when the line has no counterpart — it sits inside a range the
 * diff rewrote, so it was added or changed and there is no honest line to
 * point at. The caller drops the line number rather than guessing.
 *
 * @param hunks from `git diff -U0 <from>..<to>`, in file order as git emits
 * them.
 */
export function mapLine(hunks: readonly Hunk[], line: number): number | null {
  let offset = 0
  for (const h of hunks) {
    if (h.newLines > 0 && line >= h.newStart && line <= h.newStart + h.newLines - 1) return null
    // A pure deletion has no new lines to sit in; git records it at the line
    // it follows, so `max(newLines, 1)` keeps it from applying to that line
    // while still applying to everything below.
    if (h.newStart + Math.max(h.newLines, 1) <= line) offset += h.oldLines - h.newLines
  }
  return line + offset
}
