import type { APIRoute } from 'astro'
import { MCP_REFERENCE, mcpReferenceRoutes, mcpObjectAt, mcpNavigation } from '../lib/mcp-reference'
import { buildLocale } from '../i18n/resolve'
import { DEFAULT_LOCALE } from '../i18n/locales'
import { buildTarget } from '../lib/versions'
import { API_MODELS } from '../lib/api-models'
import { productReferenceTree } from '../lib/product-api'
import { PORTS, productAvailable, productApiPath } from '../lib/ports'
import { nativeShellContext, nativeReferenceTree } from '../lib/native-shell'

export function getStaticPaths() {
  if (buildLocale() !== DEFAULT_LOCALE) return []
  let defaults: Record<string, string> = {}
  try { defaults = JSON.parse(process.env.LIBTMUX_DOCS_PORT_DEFAULTS || '{}') } catch { /* Local defaults are latest. */ }
  const routes = mcpReferenceRoutes(process.env.LIBTMUX_DOCS_PORT, defaults, buildTarget(process.env).version)
  const products = PORTS.filter((port) => API_MODELS[port.slug] && (!process.env.LIBTMUX_DOCS_PORT || port.slug === process.env.LIBTMUX_DOCS_PORT))
    .flatMap((port) => (['mcp', 'workspace'] as const).filter((product) => productAvailable(port, product)).map((product) => ({
      model: API_MODELS[port.slug], product, version: process.env.LIBTMUX_DOCS_PORT ? buildTarget(process.env).version : defaults[port.slug] ?? 'latest',
    })))
  return [
    ...(nativeShellContext() ? [{ params: { slug: 'api/tree' }, props: { native: true } }] : []),
    ...products.map(({ model, product, version }) => ({
      params: { slug: `${process.env.LIBTMUX_DOCS_PORT ? '' : `${model.port}/${version}/`}${productApiPath(product!)}/tree` },
      props: { port: model.port, product, version },
    })),
    ...routes.map(({ path, port, section, itemSlug }) => ({ params: { slug: path }, props: { port, section, itemSlug } })),
    ...routes.filter((route) => route.section === 'tools' && !route.itemSlug).map(({ path, port }) => ({
      params: { slug: path.replace(/tools$/, 'tree') }, props: { port, tree: true },
    })),
  ]
}

export const GET: APIRoute = ({ props }) => {
  if (props.native) return new Response(JSON.stringify(nativeReferenceTree(nativeShellContext()!)),
    { headers: { 'Content-Type': 'application/json; charset=utf-8' } })
  if (props.product) return new Response(JSON.stringify(productReferenceTree(API_MODELS[props.port], props.product, props.version)),
    { headers: { 'Content-Type': 'application/json; charset=utf-8' } })
  const reference = MCP_REFERENCE[props.port]
  const object = mcpObjectAt(props.port, props.section, props.itemSlug)
  const provenance = { repo: reference.repo, revision: reference.revision, extractedRevision: reference.extractedRevision,
    selection: reference.selection, protocolVersion: reference.protocol.protocolVersion }
  const index = props.section === 'prompts' ? { ...provenance, prompts: reference.protocol.prompts }
    : props.section === 'resources' ? { ...provenance, resources: reference.protocol.resources, resourceTemplates: reference.protocol.resourceTemplates }
    : reference // tools.json remains the existing complete protocol catalog.
  const content = props.tree ? mcpNavigation(props.port).json : object?.tool ?? object?.item ?? index
  return new Response(`${JSON.stringify(content, null, 2)}\n`, { headers: { 'Content-Type': 'application/json; charset=utf-8' } })
}
