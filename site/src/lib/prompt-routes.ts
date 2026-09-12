/**
 * Where the prompt pages and files live, and who is allowed to build them.
 *
 * Shared by the four routes under `pages/prompts*` so they cannot disagree
 * about a URL. `/prompts.json` names the `.txt` files; the index page links
 * the topic pages; the topic pages link the `.txt` files. Three routes
 * spelling the same paths by hand is three chances for a manifest to advertise
 * a file nobody wrote.
 */
import { PORTS } from './ports'
import { TOPICS } from './prompts'
import { buildLocale } from '../i18n/resolve'
import { DEFAULT_LOCALE } from '../i18n/locales'

/**
 * Prompts belong to the root build of the default locale, and nothing else.
 *
 * Every port+version build renders the same routes, so without this guard
 * `/cxx/stable/prompts/` appears in eight trees that nothing links to. The
 * locale half is the same rule `[port]/index.astro` and the reference route
 * already apply: prompts cite English pages and carry absolute URLs, so a
 * translated copy would be the English text at a Japanese URL.
 */
export function buildsPrompts(): boolean {
  return !process.env.LIBTMUX_DOCS_PORT && buildLocale() === DEFAULT_LOCALE
}

/** Every (port, topic) pair, in picker order. */
export const PROMPT_PAIRS = PORTS.flatMap((port) => TOPICS.map((topic) => ({ port, topic })))

/** Site-relative path of a topic's page, without the locale. */
export const topicPath = (topicId: string): string => `prompts/${topicId}`

/** Site-relative path of one prompt's plain-text file, without the locale. */
export const textPath = (portSlug: string, topicId: string): string =>
  `prompts/${portSlug}/${topicId}.txt`
