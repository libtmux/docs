import type { APIRoute } from 'astro'
import { DEFAULT_LOCALE } from '../../../i18n/locales'
import { composeFromParts, sharedParts, type PromptContext } from '../../../lib/prompts'
import { promptPartsFor } from '../../../lib/registry'
import { buildsPrompts, PROMPT_PAIRS } from '../../../lib/prompt-routes'
import type { Port } from '../../../lib/ports'

/**
 * `/prompts/<port>/<topic>.txt` — one prompt, as the bytes an agent gets.
 *
 * The reason to publish these rather than only render a widget: a prompt is
 * text a machine consumes, and an eval runner, a shell script or an agent with
 * a fetch tool should be able to take one without parsing HTML for it. They
 * are prerendered files, so they serve from the bucket with no server, and
 * `txt` is already in the edge function's extension allowlist, so the path is
 * served rather than redirected to a trailing slash.
 *
 * Composed by the same `composeFromParts` the widget's browser code calls, so
 * what a reader copies and what a runner fetches are the same string.
 */
interface Props {
  port: Port
  topicId: string
  version: string
}

export function getStaticPaths() {
  if (!buildsPrompts()) return []
  let defaults: Record<string, string> = {}
  try {
    defaults = JSON.parse(process.env.LIBTMUX_DOCS_PORT_DEFAULTS || '{}')
  } catch {
    // Local builds default to latest.
  }
  return PROMPT_PAIRS.map(({ port, topic }) => ({
    params: { port: port.slug, topic: topic.id },
    props: {
      port,
      topicId: topic.id,
      // The port's own default, not one value for all eight: their defaults
      // differ, and `stable` is the entry that may be absent.
      version: defaults[port.slug] ?? process.env.LIBTMUX_DOCS_DEFAULT_VERSION ?? 'latest',
    } satisfies Props,
  }))
}

export const GET: APIRoute = ({ props, site }) => {
  const { port, topicId, version } = props as Props
  const origin = (site?.origin ?? 'https://libtmux.org').replace(/\/$/, '')
  const ctx: PromptContext = { docsBase: `${origin}/${DEFAULT_LOCALE}`, version }
  const text = composeFromParts(sharedParts(ctx), promptPartsFor(port, ctx), topicId)
  return new Response(`${text}\n`, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}
