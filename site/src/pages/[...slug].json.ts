import type { APIRoute } from 'astro'
import { MCP_REFERENCE, mcpReferenceRoutes } from '../lib/mcp-reference'
import { buildLocale } from '../i18n/resolve'
import { DEFAULT_LOCALE } from '../i18n/locales'
import { buildTarget } from '../lib/versions'

export function getStaticPaths() {
  if (buildLocale() !== DEFAULT_LOCALE) return []
  let defaults: Record<string, string> = {}
  try { defaults = JSON.parse(process.env.LIBTMUX_DOCS_PORT_DEFAULTS || '{}') } catch { /* Local defaults are latest. */ }
  return mcpReferenceRoutes(process.env.LIBTMUX_DOCS_PORT, defaults, buildTarget(process.env).version)
    .map(({ path, port, toolName }) => ({ params: { slug: path }, props: { port, toolName } }))
}

export const GET: APIRoute = ({ props }) => {
  const reference = MCP_REFERENCE[props.port]
  const content = props.toolName ? reference.registrations.find((tool) => tool.wireName === props.toolName) : reference
  return new Response(`${JSON.stringify(content, null, 2)}\n`, { headers: { 'Content-Type': 'application/json; charset=utf-8' } })
}
