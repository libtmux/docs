import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createLinkPreviewPolicy } from '../src/lib/link-preview-paint'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'
import { SITE_BUILT, SITE_PREFIX, SITE_ROOT } from './site-root'

/**
 * Every reference page a link can lead to has a preview payload beside it.
 *
 * The preview policy marks a link to `/<tree>/reference/<page>/` for a card, and the card asks for `<page>.preview.json`. The
 * browser check of the dev build serves one version of each port's reference, so it cannot ask for the trees at the other
 * versions the assembly builds, such as the Python reference that the other ports link to at `stable`. Those trees are the
 * shell's own: each port's shell build renders `/<slug>/<version>/reference/` (the native Sphinx output of a port is `api/`),
 * and `publishesOwnTree` says the port's publisher owns the subtree, not that it is made another way. This reads the assembly.
 *
 * A page that is only a redirect (`RedirectPage`) is not read by anyone, so no link opens a card for it: the page it names has
 * the card. The walk sets those apart as `stubs`, and asks only that each leads to a page of the tree.
 */
const ORIGIN = 'https://libtmux.org'
const policy = createLinkPreviewPolicy()

/** The directories of a tree under `root` that hold reference pages: a port's version trees, its products', and tmux's. */
function referenceRoots(root: string): string[] {
  const directories = (path: string) => (existsSync(path) ? readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name) : [])
  return directories(root).flatMap((tree) => directories(join(root, tree)).flatMap((version) => ['reference', 'mcp/reference', 'workspace/reference']
    .map((section) => `${tree}/${version}/${section}`))).filter((path) => existsSync(join(root, path)))
}

/**
 * Where a redirect page sends, when that is what the page is: the stub `RedirectPage` writes carries `noindex` and, for a
 * reader without scripts, a refresh to its destination. Only a page that has both is a stub, so a page that is merely
 * unlisted, or one that mentions a refresh, is not set apart.
 */
export function redirectDestination(html: string): string | undefined {
  if (!/<meta name="robots" content="noindex">/.test(html)) return undefined
  return /<meta http-equiv="refresh" content="0;url=([^"]+)">/.exec(html)?.[1]
}

/**
 * The reference pages the policy marks for a card, what is wrong with each one's payload, and the marked pages that are only
 * redirects (`stubs`). `base` is where the tree is served, so that a stub's destination is found in it.
 */
export function referencePayloadProblems(root: string, base = '/en/') {
  const pages: string[] = []
  const stubs: string[] = []
  const problems: string[] = []
  for (const section of referenceRoots(root)) {
    for (const entry of readdirSync(join(root, section), { withFileTypes: true })) {
      const url = `/${section}/${entry.name}/`
      const index = join(root, section, entry.name, 'index.html')
      if (!entry.isDirectory() || !existsSync(index)) continue
      const target = policy.target(url, ORIGIN)
      if (!target || !/\/reference\/[^/]+\/$/.test(url)) continue
      const file = join(root, target.endpoint)
      if (!existsSync(file)) {
        // Only a page with no payload is read, so the walk does not open every declaration page of every tree.
        const destination = redirectDestination(readFileSync(index, 'utf8'))
        if (destination === undefined) { pages.push(url); problems.push(`${url} has no payload at ${target.endpoint}`); continue }
        stubs.push(url)
        const to = new URL(destination, ORIGIN)
        if (to.origin !== ORIGIN || !to.pathname.startsWith(base) || !existsSync(join(root, to.pathname.slice(base.length), 'index.html'))) problems.push(`${url} redirects to ${destination}, which is not a page of the tree`)
        continue
      }
      pages.push(url)
      let card: { schema?: unknown; title?: unknown; description?: unknown; href?: unknown }
      try { card = JSON.parse(readFileSync(file, 'utf8')) } catch { problems.push(`${target.endpoint} is not JSON`); continue }
      if (card.schema !== 1 || typeof card.title !== 'string' || typeof card.description !== 'string') problems.push(`${target.endpoint} is not a card`)
      else if (typeof card.href !== 'string' || !new URL(card.href, ORIGIN).pathname.endsWith(url)) problems.push(`${target.endpoint} leads to ${String(card.href)}, not to ${url}`)
    }
  }
  return { pages, stubs, problems }
}

/**
 * Whether the site itself says it retired this address, so that a page that has become a redirect for any other reason does not
 * lose its card unnoticed: a tmux command's page before commands moved to the manual (the manual's routes are the commands, and
 * the full manual's old address is `manual`), and the operators that Swift's workspace reference dropped.
 */
async function retiredAddress(): Promise<(url: string) => boolean> {
  // Loaded here and not at the top: the models are large, and only the assembled run needs them.
  const [{ API_MODELS }, { productApiRedirects }, { tmuxManualRoutes }] = await Promise.all([
    import('../src/lib/api-models'), import('../src/lib/product-api'), import('../src/lib/tmux-manual-data'),
  ])
  const commands = new Set(tmuxManualRoutes().filter(({ slug }) => slug)
    .map(({ version, slug }) => `/tmux/${version}/reference/${slug === 'full' ? 'manual' : slug}/`))
  const operators = productApiRedirects(API_MODELS, 'swift', {}, 'latest').map(({ path }) => path)
  return (url) => commands.has(url) || operators.some((path) => new RegExp(`^/swift/[^/]+/${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/$`).test(url))
}

/** A bare shell build has no port trees to read; an assembly has them, and then there must be pages in them. */
const assembledTrees = SITE_BUILT && referenceRoots(SITE_ROOT).length > 0

describe('the reference trees of the assembly', () => {
  // The walk lists every tree of the assembly, which takes longer than the default deadline allows.
  it.runIf(assembledTrees)('has a payload beside every reference page the preview policy marks, in every port version and in tmux', async () => {
    const { pages, stubs, problems } = referencePayloadProblems(SITE_ROOT, `/${SITE_PREFIX}`)
    expect(pages.length).toBeGreaterThan(0)
    expect(problems).toEqual([])
    // What the walk set apart is bounded by what the site says it retired, and not by what is convenient to leave out.
    const retired = await retiredAddress()
    expect(stubs.filter((url) => !retired(url))).toEqual([])
  }, 120_000)
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
    expect(referencePayloadProblems(root)).toEqual({ pages: ['/py/stable/reference/a/', '/ruby/latest/mcp/reference/b/'], stubs: [], problems: [] })
    const missing = tree({ 'py/stable/reference/a/index.html': '', 'py/stable/reference/b/index.html': '', 'py/stable/reference/a.preview.json': card('/en/py/stable/reference/a/') })
    expect(referencePayloadProblems(missing).problems).toEqual(['/py/stable/reference/b/ has no payload at /py/stable/reference/b.preview.json'])
  })

  it('sets apart a page that is only a redirect, and still names a page with no payload beside it', async () => {
    // The stub is what the site writes, so the walk is tested against the real markup and follows it if that changes.
    const page = await loadAstroTemplate('components/docs/RedirectPage.astro')
    const stub = (destination: string) => renderAstroTemplate(page, { props: { destination, title: 'tmux manual' } })
    expect(redirectDestination(await stub('/en/tmux/latest/manual/set-buffer/'))).toBe('/en/tmux/latest/manual/set-buffer/')
    // Unlisted is not a redirect, and neither is a page that says nothing of where it goes.
    expect(redirectDestination('<meta name="robots" content="noindex">')).toBeUndefined()
    expect(redirectDestination('<meta http-equiv="refresh" content="0;url=/en/x/">')).toBeUndefined()
    const root = tree({
      'tmux/latest/reference/set-buffer/index.html': await stub('/en/tmux/latest/manual/set-buffer/'), 'tmux/latest/manual/set-buffer/index.html': '',
      'tmux/latest/reference/real/index.html': '<!doctype html><title>real</title>',
      'tmux/latest/reference/unlisted/index.html': '<meta name="robots" content="noindex">',
      'tmux/latest/reference/dangling/index.html': await stub('/en/tmux/latest/manual/dangling/'),
      'tmux/latest/reference/abroad/index.html': await stub('https://elsewhere.test/en/tmux/latest/manual/set-buffer/'),
    })
    const walked = referencePayloadProblems(root)
    expect(walked.stubs.sort()).toEqual(['/tmux/latest/reference/abroad/', '/tmux/latest/reference/dangling/', '/tmux/latest/reference/set-buffer/'])
    expect(walked.problems.sort()).toEqual([
      '/tmux/latest/reference/abroad/ redirects to https://elsewhere.test/en/tmux/latest/manual/set-buffer/, which is not a page of the tree',
      '/tmux/latest/reference/dangling/ redirects to /en/tmux/latest/manual/dangling/, which is not a page of the tree',
      '/tmux/latest/reference/real/ has no payload at /tmux/latest/reference/real.preview.json',
      '/tmux/latest/reference/unlisted/ has no payload at /tmux/latest/reference/unlisted.preview.json',
    ])
    // The control: the same tree with only the stub that leads to a page is clean, and its page is not one that needs a payload.
    const clean = tree({ 'tmux/latest/reference/set-buffer/index.html': await stub('/en/tmux/latest/manual/set-buffer/'), 'tmux/latest/manual/set-buffer/index.html': '' })
    expect(referencePayloadProblems(clean)).toEqual({ pages: [], stubs: ['/tmux/latest/reference/set-buffer/'], problems: [] })
    // A tree served below a preview's prefix finds its destination there.
    expect(referencePayloadProblems(clean, '/pr-9/en/').problems).toEqual(['/tmux/latest/reference/set-buffer/ redirects to /en/tmux/latest/manual/set-buffer/, which is not a page of the tree'])
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
