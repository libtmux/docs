import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createLinkPreviewPolicy } from '../src/lib/link-preview-paint'
import { SITE_BUILT, SITE_ROOT } from './site-root'

/**
 * Every reference page a link can lead to has a preview payload beside it.
 *
 * The preview policy marks a link to `/<tree>/reference/<page>/` for a card, and the card asks for `<page>.preview.json`. The
 * browser check of the dev build serves one version of each port's reference, so it cannot ask for the trees at the other
 * versions the assembly builds, such as the Python reference that the other ports link to at `stable`. Those trees are the
 * shell's own: each port's shell build renders `/<slug>/<version>/reference/` (the native Sphinx output of a port is `api/`),
 * and `publishesOwnTree` says the port's publisher owns the subtree, not that it is made another way. This reads the assembly.
 */
const ORIGIN = 'https://libtmux.org'
const policy = createLinkPreviewPolicy()

/** The directories of a tree under `root` that hold reference pages: a port's version trees, its products', and tmux's. */
function referenceRoots(root: string): string[] {
  const directories = (path: string) => (existsSync(path) ? readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name) : [])
  return directories(root).flatMap((tree) => directories(join(root, tree)).flatMap((version) => ['reference', 'mcp/reference', 'workspace/reference']
    .map((section) => `${tree}/${version}/${section}`))).filter((path) => existsSync(join(root, path)))
}

/** The reference pages the policy marks for a card, and what is wrong with each one's payload. */
export function referencePayloadProblems(root: string) {
  const pages: string[] = []
  const problems: string[] = []
  for (const base of referenceRoots(root)) {
    for (const entry of readdirSync(join(root, base), { withFileTypes: true })) {
      const url = `/${base}/${entry.name}/`
      if (!entry.isDirectory() || !existsSync(join(root, base, entry.name, 'index.html'))) continue
      const target = policy.target(url, ORIGIN)
      if (!target || !/\/reference\/[^/]+\/$/.test(url)) continue
      pages.push(url)
      const file = join(root, target.endpoint)
      if (!existsSync(file)) { problems.push(`${url} has no payload at ${target.endpoint}`); continue }
      let card: { schema?: unknown; title?: unknown; description?: unknown; href?: unknown }
      try { card = JSON.parse(readFileSync(file, 'utf8')) } catch { problems.push(`${target.endpoint} is not JSON`); continue }
      if (card.schema !== 1 || typeof card.title !== 'string' || typeof card.description !== 'string') problems.push(`${target.endpoint} is not a card`)
      else if (typeof card.href !== 'string' || !new URL(card.href, ORIGIN).pathname.endsWith(url)) problems.push(`${target.endpoint} leads to ${String(card.href)}, not to ${url}`)
    }
  }
  return { pages, problems }
}

/** A bare shell build has no port trees to read; an assembly has them, and then there must be pages in them. */
const assembledTrees = SITE_BUILT && referenceRoots(SITE_ROOT).length > 0

describe('the reference trees of the assembly', () => {
  it.runIf(assembledTrees)('has a payload beside every reference page the preview policy marks, in every port version and in tmux', () => {
    const { pages, problems } = referencePayloadProblems(SITE_ROOT)
    expect(pages.length).toBeGreaterThan(0)
    expect(problems).toEqual([])
  })
})

describe('the walk over a tree', () => {
  const made: string[] = []
  afterEach(() => { for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true }) })
  const tree = (files: Record<string, string>) => {
    const root = mkdtempSync(join(tmpdir(), 'reference-previews-'))
    made.push(root)
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(join(root, path, '..'), { recursive: true })
      writeFileSync(join(root, path), body)
    }
    return root
  }
  const card = (href: string) => JSON.stringify({ schema: 1, title: 'x', description: '', href })

  it('passes a tree whose pages each have a payload that leads back to them, and names the page that has none', () => {
    const root = tree({
      'py/stable/reference/a/index.html': '', 'py/stable/reference/a.preview.json': card('/en/py/stable/reference/a/'),
      'ruby/latest/mcp/reference/b/index.html': '', 'ruby/latest/mcp/reference/b.preview.json': card('/en/ruby/latest/mcp/reference/b/'),
      // Not pages a link is marked for: the index of the tree, and a page two segments down.
      'py/stable/reference/index.html': '', 'py/stable/reference/symbols/a/index.html': '',
    })
    expect(referencePayloadProblems(root)).toEqual({ pages: ['/py/stable/reference/a/', '/ruby/latest/mcp/reference/b/'], problems: [] })
    const missing = tree({ 'py/stable/reference/a/index.html': '', 'py/stable/reference/b/index.html': '', 'py/stable/reference/a.preview.json': card('/en/py/stable/reference/a/') })
    expect(referencePayloadProblems(missing).problems).toEqual(['/py/stable/reference/b/ has no payload at /py/stable/reference/b.preview.json'])
  })

  it('names a payload that is not a card or leads to another page', () => {
    const root = tree({
      'go/latest/reference/a/index.html': '', 'go/latest/reference/a.preview.json': JSON.stringify({ schema: 2, title: 'x', description: '' }),
      'go/latest/reference/b/index.html': '', 'go/latest/reference/b.preview.json': card('/en/go/latest/reference/c/'),
      'go/latest/reference/c/index.html': '', 'go/latest/reference/c.preview.json': '{',
    })
    expect(referencePayloadProblems(root).problems).toEqual([
      '/go/latest/reference/a.preview.json is not a card', '/go/latest/reference/b.preview.json leads to /en/go/latest/reference/c/, not to /go/latest/reference/b/', '/go/latest/reference/c.preview.json is not JSON',
    ])
  })
})
