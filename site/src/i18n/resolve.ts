import { execFileSync } from 'node:child_process'
import { getCollection, type CollectionEntry } from 'astro:content'
import { DEFAULT_LOCALE, LOCALES, isLocale, type Locale } from './locales.ts'

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

/**
 * The one locale this build renders.
 *
 * SITE_ROOT is a single value per Astro invocation, so a build that emitted
 * two locales gave one of them the other's prefix — a Japanese page whose
 * every link pointed into `/en/`. One locale per build is what makes the
 * prefix correct for every page in it.
 *
 * A port build always renders the default locale: the reference is not
 * translated, and per-port prose is the language-filtered English.
 */
export function buildLocale(env: NodeJS.ProcessEnv = process.env): Locale {
  if (env.LIBTMUX_DOCS_PORT) return DEFAULT_LOCALE
  const named = env.LIBTMUX_DOCS_LOCALE
  return named && isLocale(named) ? named : DEFAULT_LOCALE
}

export type TranslationState = 'translated' | 'stale' | 'missing'

/**
 * What a locale offers for one page.
 *
 * `placeholder` is the fourth state and the one the switcher needs: the URL
 * resolves, but what it serves says the page is untranslated rather than
 * pretending otherwise. It is distinct from `missing`, which meant the URL
 * did not exist at all.
 */
export type LocaleStatus = 'translated' | 'stale' | 'placeholder'

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

/**
 * Every locale's status for one English page, keyed by locale.
 *
 * The default locale is always `translated` — it is the source. Every other
 * locale is `translated`, `stale`, or `placeholder`, so the switcher can
 * offer all of them and say plainly which is which. A locale never appears
 * absent, because a placeholder is served in its place.
 */
export async function localeStatusesFor(sourceId: string): Promise<Record<string, LocaleStatus>> {
  const entries = await getCollection('docs')
  const source = entries.find((e) => e.id === sourceId)
  const statuses: Record<string, LocaleStatus> = { [DEFAULT_LOCALE]: 'translated' }
  for (const locale of LOCALES) {
    if (locale === DEFAULT_LOCALE) continue
    const translation = entries.find(
      (e) => localeOf(e.id) === locale && sourceIdOf(e.id) === sourceId,
    )
    if (!translation) {
      statuses[locale] = 'placeholder'
      continue
    }
    const state = translationState(translation, source)
    statuses[locale] = state === 'stale' ? 'stale' : 'translated'
  }
  return statuses
}

/**
 * The English pages a locale has no translation for.
 *
 * Drives the placeholder routes: one per (locale, untranslated page) pair, so
 * every page answers in every locale.
 */
export async function placeholderPairs(): Promise<{ locale: Locale; sourceId: string }[]> {
  const entries = await getCollection('docs')
  const sources = entries.filter((e) => localeOf(e.id) === DEFAULT_LOCALE).map((e) => e.id)
  const pairs: { locale: Locale; sourceId: string }[] = []
  for (const locale of LOCALES) {
    if (locale === DEFAULT_LOCALE) continue
    for (const sourceId of sources) {
      const has = entries.some((e) => localeOf(e.id) === locale && sourceIdOf(e.id) === sourceId)
      if (!has) pairs.push({ locale, sourceId })
    }
  }
  return pairs
}
