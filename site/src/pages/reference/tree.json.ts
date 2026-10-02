/**
 * A port's whole reference tree, for the branches a page does not render.
 *
 * A page carries only its own branch, so the rest of the tree is fetched once
 * when a reader first opens another bucket or type. Buckets carry their
 * types, and members are keyed by type so a type opens without a second
 * request. Slugs rather than URLs: the page knows its own root.
 *
 * One file per port shell, beside that port's reference, so the tree a page
 * loads is the tree of the port it belongs to. The root build has no port and
 * writes nothing.
 */
import type { APIRoute } from 'astro'
import { API_MODELS } from '../../lib/api-models'
import { referenceTree } from '../../lib/api-tree'

export const GET: APIRoute = () => {
  const port = process.env.LIBTMUX_DOCS_PORT ?? ''
  if (!API_MODELS[port]) return new Response('Not found', { status: 404 })
  return new Response(JSON.stringify(referenceTree(port)), { headers: { 'Content-Type': 'application/json' } })
}
