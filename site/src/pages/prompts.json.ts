import type { APIRoute } from 'astro'
import { createHash } from 'node:crypto'
import { DEFAULT_LOCALE } from '../i18n/locales'
import { composeFromParts, sharedParts, TOPICS, type PromptContext } from '../lib/prompts'
import { promptPartsFor, registryFor } from '../lib/registry'
import { buildsPrompts, PROMPT_PAIRS, textPath, topicPath } from '../lib/prompt-routes'

/**
 * `/prompts.json` — every prompt, addressable.
 *
 * An eval runner should be able to enumerate what exists and fetch each one
 * without scraping a page or guessing a URL pattern. It names the `.txt` file
 * for each pair, the page a human would read, and the registry state the
 * install line was composed from, so a run can record what it actually tested
 * against rather than "latest, probably".
 *
 * `sha` is the SHA-256 of the prompt body as published. A runner that stores it
 * alongside a result can tell whether a later disagreement is a model change or
 * a prompt change, which is the question that otherwise takes an afternoon.
 *
 * Sibling of `/docs.json` in intent and deliberately not in schema: that file
 * matches `sphinx-gp-llms` field for field because the Python port publishes
 * one too and two manifests contradicting each other is worse than either.
 * Nothing else publishes this one.
 */
export const GET: APIRoute = ({ site }) => {
  if (!buildsPrompts()) return new Response(null, { status: 404 })
  const origin = (site?.origin ?? 'https://libtmux.org').replace(/\/$/, '')
  const base = `${origin}/${DEFAULT_LOCALE}`
  let defaults: Record<string, string> = {}
  try {
    defaults = JSON.parse(process.env.LIBTMUX_DOCS_PORT_DEFAULTS || '{}')
  } catch {
    // Local builds default to latest.
  }

  const prompts = PROMPT_PAIRS.map(({ port, topic }) => {
    const version = defaults[port.slug] ?? process.env.LIBTMUX_DOCS_DEFAULT_VERSION ?? 'latest'
    const ctx: PromptContext = { docsBase: base, version }
    const text = composeFromParts(sharedParts(ctx), promptPartsFor(port, ctx), topic.id)
    const entry = registryFor(port)
    return {
      port: port.slug,
      language: port.language,
      topic: topic.id,
      title: topic.label,
      description: topic.summary,
      version,
      url: `${base}/${topicPath(topic.id)}/`,
      text: `${base}/${textPath(port.slug, topic.id)}`,
      bytes: text.length + 1,
      sha256: createHash('sha256').update(`${text}\n`).digest('hex'),
      // What the prompt tells the reader to install, and where that came from.
      install: {
        status: entry.status,
        version: entry.version,
        tag: entry.tag,
        registry: (port.registry?.name ?? 'its repository'),
      },
    }
  })

  const body = {
    schema: 1,
    name: 'libtmux agent prompts',
    url: `${base}/prompts/`,
    description:
      'Prompts that set up libtmux in a repository and build something with it, one per language and task.',
    sourceRepository: 'https://github.com/libtmux/docs',
    topics: TOPICS.map((topic) => ({
      id: topic.id,
      title: topic.label,
      description: topic.summary,
      url: `${base}/${topicPath(topic.id)}/`,
    })),
    prompts,
  }

  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
