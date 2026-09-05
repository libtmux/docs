import { execFileSync } from 'node:child_process'
import { getCollection, type CollectionEntry } from 'astro:content'
import { DEFAULT_LOCALE, isLocale, type Locale } from './locales.ts'

/**
 * Locale routing for the shell's one catch-all route.
 *
 * There is no `astro:i18n` here, on purpose. Astro's built-in router assumes
 * locale-keyed page directories with middleware; this shell resolves every
 * page from one content collection through `[...slug].astro`. Bolting the
 * framework router onto that buys `Astro.currentLocale` and a fallback-rewrite
 * that still leaves us writing the canonical tags, the hreflang cluster, the
 * sitemap exclusion and the banner ourselves — the Starlight argument one
 * layer down (00-DECISIONS.md §1.1). Locale is the leading path segment; that
 * is the whole routing model.
 */

/** The locale a collection entry belongs to, from its leading path segment. */
export function localeOf(entryId: string): Locale {
  const [first] = entryId.split('/')
  return isLocale(first) && first !== DEFAULT_LOCALE ? first : DEFAULT_LOCALE
}

/** The entry id this one translates, i.e. the same path without the locale. */
export function sourceIdOf(entryId: string): string {
  const locale = localeOf(entryId)
  return locale === DEFAULT_LOCALE ? entryId : entryId.slice(locale.length + 1)
}

/**
 * Whether this build may emit non-default locales.
 *
 * `[...slug].astro` runs in every one of the fourteen shell builds, so without
 * a guard a Japanese page would also be emitted at `/py/stable/ja/concepts/`
 * — a URL that means nothing, since the reference is never localised and the
 * per-port prose is already the language-filtered English.
 *
 * The test is the port, deliberately not the base. Gating on `base === '/'`
 * as well looks equivalent — every port build does carry a base — but it also
 * silences translations in a PR preview, which mounts the whole site at
 * `/pr-42/` with no port. A pull request that adds a translation is exactly
 * the one whose preview needs to show it.
 */
export function localesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !env.LIBTMUX_DOCS_PORT
}

export type TranslationState = 'translated' | 'stale' | 'missing'

/**
 * The commit that last touched a file, or null when git cannot answer.
 *
 * Absence is not staleness: a shallow CI checkout, an export tarball, or a
 * file that is staged but not yet committed all produce no sha, and none of
 * those means the translation drifted. Callers treat null as "cannot tell"
 * and leave the page in its declared state.
 */
function lastCommitOf(filePath: string): string | null {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%H', '--', filePath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.trim() || null
  } catch {
    return null
  }
}

/**
 * Three states, not Astro's two.
 *
 * A translation that exists but predates a change to its English source is not
 * the same as one that never existed, and saying so is the only mechanism that
 * keeps machine translation honest: a freshly generated file declares the sha
 * it was made from, and the next edit to the English page moves it to `stale`
 * without anyone remembering to.
 */
export function translationState(
  entry: CollectionEntry<'docs'>,
  source: CollectionEntry<'docs'> | undefined,
): TranslationState {
  if (!source) return 'missing'
  const declared = entry.data.source_commit
  if (!declared) return 'stale'
  const current = lastCommitOf(source.filePath ?? '')
  if (!current) return 'translated'
  return current === declared ? 'translated' : 'stale'
}

/** Every locale that has a real translation of `sourceId`, default first. */
export async function localesFor(sourceId: string): Promise<Locale[]> {
  const entries = await getCollection('docs')
  const found = new Set<Locale>([DEFAULT_LOCALE])
  for (const entry of entries) {
    const locale = localeOf(entry.id)
    if (locale !== DEFAULT_LOCALE && sourceIdOf(entry.id) === sourceId) found.add(locale)
  }
  return [...found]
}
