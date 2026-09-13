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
import { bucketTotal, firstEntry, membersByType, navTree, type TreeBucket } from '../../lib/api-tree'

export const GET: APIRoute = () => {
  const port = process.env.LIBTMUX_DOCS_PORT ?? ''
  if (!API_MODELS[port]) return new Response('Not found', { status: 404 })
  const members = membersByType(port)
  const bucket = (b: TreeBucket): unknown => ({
    id: b.id,
    label: b.label,
    count: bucketTotal(b),
    slug: firstEntry(b)?.slug ?? null,
    types: b.entries.map((t) => ({ id: t.id, name: t.name, slug: t.slug, m: members.has(t.id) ? 1 : 0 })),
    children: b.children.map(bucket),
  })
  const body = {
    port,
    buckets: navTree(port).map(bucket),
    members: Object.fromEntries([...members].map(([id, list]) => [id, list.map((m) => [m.name, m.slug])])),
  }
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
}
