import { DEFAULT_LOCALE, type Locale } from './locales.ts'

/**
 * Where a reader becomes a translator: GitHub's own editor, on the file that
 * would hold this page's translation.
 *
 * Two URLs, because GitHub has two. A file that exists opens in the editor;
 * one that does not opens the new-file form with its path and a starting body
 * filled in. Sending someone to the editor for a path that does not exist
 * yields a 404, and sending them to the new-file form for a path that does
 * silently offers to overwrite it — so which one is used is decided from
 * whether the translation is really there, never guessed.
 *
 * The repository is the canonical origin rather than this checkout's push
 * remote: a contributor's fork is made from the former, and a link to a
 * personal fork would be an invitation into someone else's namespace.
 *
 * KNOWN LIMIT, decided rather than overlooked: that repository is private
 * while the site is under construction, so these links reach collaborators
 * only and everyone else gets GitHub's 404 — indistinguishable, from their
 * side, from a broken link. The alternatives were to make the repository
 * public, or to route contributions somewhere needing no repository access
 * (a public content-only repository, or an issue-form intake). Shipping the
 * links as they are was chosen over both, on the grounds that they work for
 * the people who can use them today and cost nothing to widen later.
 *
 * The coverage page carries `i18n.accessNote` so a reader meets that 404 with
 * an explanation instead of a dead end. If the repository goes public, or a
 * contribution target that needs no access appears, this file and that string
 * are the two places to change.
 */
export const CONTRIBUTE_REPO = 'libtmux/docs'
export const CONTRIBUTE_BRANCH = 'main'

const BASE = `https://github.com/${CONTRIBUTE_REPO}`

/**
 * The source file's path from the repository root.
 *
 * `entry.filePath` is relative to the Astro project, which is `site/`, while
 * GitHub wants the path from the repository root. Handled here rather than at
 * each call site so the two cannot drift apart.
 */
export function repoPath(filePath: string): string {
  const clean = filePath.replace(/^\/+/, '')
  return clean.startsWith('site/') ? clean : `site/${clean}`
}

/**
 * The file that holds `locale`'s translation of the entry at `sourceFilePath`.
 *
 * Mirrors the English file exactly, one directory deeper. Deriving it from the
 * entry id instead would have to guess between `concepts.md` and
 * `concepts/index.md` — the glob loader strips `/index`, so both produce the
 * id `concepts` and only the real file says which shape this page uses.
 *
 * Idempotent, because the caller may hand it either file. A placeholder is
 * rendered from the English entry, whose path needs the locale added; a real
 * translation is rendered from its own entry, whose path already has it.
 * Adding it unconditionally produced `docs/ja/ja/concepts/…`.
 */
export function translationPath(sourceFilePath: string, locale: Locale): string {
  const path = repoPath(sourceFilePath)
  const marker = 'src/content/docs/'
  const at = path.indexOf(marker)
  if (at === -1) return path
  const head = path.slice(0, at + marker.length)
  const tail = path.slice(at + marker.length)
  if (locale === DEFAULT_LOCALE) return path
  return tail.startsWith(`${locale}/`) ? path : `${head}${locale}/${tail}`
}

/** A starting body for a translation that does not exist yet. */
function seedFor(title: string, description: string | undefined, locale: Locale): string {
  const front = [
    '---',
    `title: ${title}`,
    ...(description ? [`description: ${description}`] : []),
    '---',
    '',
    `<!-- ${locale}: translate the English page below. Keep the frontmatter`,
    '     keys as they are; translate their values. Delete this comment. -->',
    '',
  ]
  return front.join('\n')
}

export interface ContributeLink {
  href: string
  /** True when the file does not exist yet, so the label can say so. */
  isNew: boolean
}

/**
 * The editor link for one page in one locale.
 *
 * `exists` is passed in rather than looked up here: the caller already knows,
 * from the same collection query that decided whether to render a placeholder,
 * and a second answer computed differently is a second answer that can differ.
 */
export function contributeLink(
  sourceFilePath: string,
  locale: Locale,
  exists: boolean,
  page: { title: string; description?: string },
): ContributeLink {
  const path = translationPath(sourceFilePath, locale)
  if (exists) return { href: `${BASE}/edit/${CONTRIBUTE_BRANCH}/${path}`, isNew: false }
  const params = new URLSearchParams({ filename: path, value: seedFor(page.title, page.description, locale) })
  return { href: `${BASE}/new/${CONTRIBUTE_BRANCH}?${params}`, isNew: true }
}
