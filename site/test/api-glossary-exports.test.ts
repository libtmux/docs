import { afterEach, expect, it, vi } from 'vitest'
vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []), render: vi.fn(async () => ({ headings: [] })) }))
import { glossaryPages, productGlossaryPaths } from '../src/lib/api-glossary-routes'
import { apiGlossaryBody, apiGlossaryMarkdown } from '../src/lib/api-glossary'
import { llmsPages } from '../src/lib/llms'
import { markdownDocument } from '../src/lib/markdown-twins'
import { GET as manifest } from '../src/pages/docs.json'
import { getStaticPaths as jsonPaths } from '../src/pages/[...scope]/reference/glossary.json'
import { getStaticPaths as markdownPaths } from '../src/pages/[...scope]/reference/glossary.md'

afterEach(() => vi.unstubAllEnvs())

it('carries native glossary content and destinations into the manifest and full LLM text', async () => {
  vi.stubEnv('LIBTMUX_DOCS_PORT', 'scala')
  vi.stubEnv('LIBTMUX_DOCS_VERSION', 'v9-proof')
  const origin = 'https://libtmux.org'
  const pages = glossaryPages()
  const llms = await llmsPages(origin, '/en/scala/v9-proof/')
  const json = await (await manifest({ site: new URL(origin) } as Parameters<typeof manifest>[0])).json()
  expect(pages.length).toBeGreaterThan(0)
  for (const page of pages) {
    const url = new URL(page.path, origin).href
    expect(url).toContain('/scala/v9-proof/')
    const exported = llms.find((entry) => entry.url === url)!
    expect(exported).toBeDefined()
    expect(exported.body).toBe(apiGlossaryBody(page.path))
    expect(exported.body).toContain('A Scala method declared with def')
    expect(exported.body).not.toMatch(/Python|Julia/)
    expect(markdownDocument(exported)).toBe(apiGlossaryMarkdown(origin, page.path))
    const entry = json.pages.find((entry: { url: string }) => entry.url === url)
    expect(entry).toMatchObject({ title: page.title, markdownUrl: `${url.slice(0, -1)}.md`, jsonUrl: `${url.slice(0, -1)}.json` })
    expect(entry.headings).toContainEqual({ id: 'method', level: 3, text: 'method' })
    expect(Boolean(exported.body.includes('### readOnlyHint'))).toBe(page.product === 'mcp')
  }
  expect(llms).toHaveLength(pages.length)
  expect(llms.every((page) => page.url.includes('/scala/'))).toBe(true)
})

it('builds product HTML and both twins from one availability and version selection', () => {
  vi.stubEnv('LIBTMUX_DOCS_PORT', '')
  vi.stubEnv('LIBTMUX_DOCS_LOCALE', 'en')
  vi.stubEnv('LIBTMUX_DOCS_PORT_DEFAULTS', JSON.stringify({ py: 'stable', scala: 'v9-proof' }))
  const paths = productGlossaryPaths()
  expect(paths.length).toBeGreaterThan(0)
  expect(jsonPaths()).toEqual(paths)
  expect(markdownPaths()).toEqual(paths)
  expect(paths.every((entry) => entry.params.scope === `${entry.props.port}/${entry.props.version}/${entry.props.product}`)).toBe(true)
  expect(paths.filter((entry) => entry.props.port === 'py').every((entry) => entry.props.version === 'stable')).toBe(true)
  vi.stubEnv('LIBTMUX_DOCS_PORT', 'py')
  vi.stubEnv('LIBTMUX_DOCS_VERSION', 'v9-proof')
  expect(productGlossaryPaths().every((entry) => entry.params.scope === entry.props.product && entry.props.version === 'v9-proof')).toBe(true)
  vi.stubEnv('LIBTMUX_DOCS_PORT', '')
  vi.stubEnv('LIBTMUX_DOCS_LOCALE', 'ja')
  expect(productGlossaryPaths()).toEqual([])
})
