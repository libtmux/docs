import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLinkPreviewPolicy } from '../src/lib/link-preview-paint'
import { pagePreview, proseReferencePreviews } from '../src/lib/link-preview'

const docs = vi.hoisted(() => {
  const page = (id: string, data: Record<string, unknown>) => ({ id, data: { title: id, description: `About ${id}.`, ...data } })
  return {
    entries: [
      // Product pages below a port's reference section, one authored for the port and one shared by every port.
      page('ports/go/workspace/reference/compatibility', { port: 'go', product: 'workspace', title: 'Runtime and configuration support' }),
      page('ports/go/workspace/reference/exit-codes', { port: 'go', product: 'workspace', title: 'Exit codes and errors', description: 'Use process status to handle failures.' }),
      page('ports/rs/workspace/reference/exit-codes', { port: 'rs', product: 'workspace', title: 'Exit codes and errors' }),
      // Pages a link is not marked for: a guide, the section's own index, and tmux prose that no port owns.
      page('ports/go/workspace/guides/automation', { port: 'go', product: 'workspace' }),
      page('ports/go/workspace/reference', { port: 'go', product: 'workspace' }),
      page('guides/first-steps', {}),
      // A port's page that is no product's: a port build writes it, a root build leaves it to the port's own.
      page('ports/go/reference/migrating', { port: 'go', route: 'reference/migrating' }),
    ],
  }
})
vi.mock('astro:content', () => ({
  getCollection: async (_name: string, filter?: (entry: (typeof docs.entries)[number]) => boolean) => docs.entries.filter(filter ?? (() => true)),
}))
import { getStaticPaths, GET } from '../src/pages/[...slug].preview.json'

afterEach(() => vi.unstubAllEnvs())

const slugs = async () => (await getStaticPaths()).map((path) => path.params.slug)

describe('the card of a prose page in a reference section', () => {
  it('is the page\'s own title and summary, with the link to the page', () => {
    expect(pagePreview({ title: 'Exit codes and errors', description: 'Use process status.' }, '/en/go/latest/workspace/reference/exit-codes/'))
      .toEqual({ schema: 1, title: 'Exit codes and errors', description: 'Use process status.', href: '/en/go/latest/workspace/reference/exit-codes/', actionLabel: 'Open page' })
    expect(pagePreview({ title: 'No summary' }, '/en/go/latest/workspace/reference/x/').description).toBe('')
  })

  it('is written for the pages the preview policy marks and for no other', () => {
    const pages = [
      { title: 'Exit codes', href: '/en/go/latest/workspace/reference/exit-codes/' },
      { title: 'Automation', href: '/en/go/latest/workspace/guides/automation/' },
      { title: 'Reference', href: '/en/go/latest/workspace/reference/' },
    ]
    const policy = createLinkPreviewPolicy()
    expect(proseReferencePreviews(pages).map(({ href }) => href)).toEqual(['/en/go/latest/workspace/reference/exit-codes/'])
    // The payload is where the policy looks for the card of the page it describes.
    expect(policy.target(pages[0]!.href, 'https://libtmux.org')?.endpoint).toBe('/en/go/latest/workspace/reference/exit-codes.preview.json')
    expect(pages.filter((page) => policy.target(page.href, 'https://libtmux.org')).map((page) => page.title)).toEqual(['Exit codes'])
  })
})

describe('the payloads a root build writes', () => {
  it('include the prose reference pages of a product, at each port\'s version, and no page the policy leaves alone', async () => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', '')
    const written = await slugs()
    expect(written).toEqual(expect.arrayContaining([
      'go/latest/workspace/reference/compatibility', 'go/latest/workspace/reference/exit-codes', 'rs/latest/workspace/reference/exit-codes',
    ]))
    expect(written).not.toContain('go/latest/workspace/guides/automation')
    expect(written).not.toContain('go/latest/workspace/reference')
    expect(written).not.toContain('go/latest/reference/migrating')
    expect(written.filter((slug) => slug.startsWith('guides'))).toEqual([])
  })

  it('answer with the card, and the versions a port is built at', async () => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', '')
    vi.stubEnv('LIBTMUX_DOCS_PORT_DEFAULTS', JSON.stringify({ go: 'v0.46.2' }))
    const path = (await getStaticPaths()).find(({ params }) => params.slug === 'go/v0.46.2/workspace/reference/exit-codes')!
    expect(path).toBeDefined()
    const card = await (await GET({ props: path.props } as unknown as Parameters<typeof GET>[0])).json()
    expect(card).toMatchObject({ schema: 1, title: 'Exit codes and errors', description: 'Use process status to handle failures.', actionLabel: 'Open page' })
    expect(card.href).toMatch(/\/go\/v0.46.2\/workspace\/reference\/exit-codes\/$/)
  })
})

describe('the payloads a port build writes', () => {
  // A port build reads its root and base when its modules load, as the assembly sets them.
  async function portBuild() {
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'go')
    vi.stubEnv('LIBTMUX_DOCS_VERSION', 'v0.46.2')
    vi.stubEnv('LIBTMUX_DOCS_BASE', '/en/go/v0.46.2/')
    vi.stubEnv('LIBTMUX_DOCS_PORT_ROOT', '/en')
    vi.resetModules()
    return import('../src/pages/[...slug].preview.json')
  }

  it('include every prose page of the port the policy marks, beside the page, and none of another port\'s', async () => {
    const route = await portBuild()
    const paths = await route.getStaticPaths()
    const written = paths.map((path) => path.params.slug)
    expect(written).toEqual(expect.arrayContaining(['workspace/reference/compatibility', 'workspace/reference/exit-codes', 'reference/migrating']))
    expect(written).not.toContain('workspace/guides/automation')
    expect(written).not.toContain('workspace/reference')
    expect(written.filter((slug) => slug.startsWith('rs/') || slug.includes('/rs/'))).toEqual([])
    const path = paths.find(({ params }) => params.slug === 'reference/migrating')!
    expect((await (await route.GET({ props: path.props } as unknown as Parameters<typeof route.GET>[0])).json()).href).toBe('/en/go/v0.46.2/reference/migrating/')
  })
})
