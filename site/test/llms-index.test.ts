import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []) }))
import { exportsMcpContracts, referenceEntries } from '../src/lib/llms'
import { parseSlots } from '../src/lib/workspace-shared-slots'
import { PORTS, productAvailable } from '../src/lib/ports'

afterEach(() => vi.unstubAllEnvs())

const origin = 'https://libtmux.org'

it('lists a port\'s root classes and modules with their first-sentence summaries', () => {
  vi.stubEnv('LIBTMUX_DOCS_PORT', 'clojure')
  vi.stubEnv('LIBTMUX_DOCS_VERSION', 'latest')
  const lines = referenceEntries(origin)
  expect(lines.length).toBeGreaterThanOrEqual(5)
  expect(lines.join('\n')).toMatch(/\[libtmux\.core\]\(https:\/\/libtmux\.org\/\S+\/libtmux-core\/\): Explicit tmux effects through open! and snapshot!\./)
  expect(lines.join('\n')).not.toContain('[[')
  vi.stubEnv('LIBTMUX_DOCS_PORT', '')
  expect(referenceEntries(origin)).toEqual([])
})

it('mentions MCP contracts only where the port ships an MCP server', () => {
  for (const port of PORTS.filter((entry) => !entry.parentLibrary)) {
    vi.stubEnv('LIBTMUX_DOCS_PORT', port.slug)
    expect(exportsMcpContracts(), port.slug).toBe(productAvailable(port, 'mcp'))
  }
})

it('scopes the llms-full.txt row of the linking guide to the same ports', () => {
  const raw = readFileSync(new URL('../src/content/docs/meta/linking.md', import.meta.url), 'utf8')
  const regions = parseSlots(raw).children.flatMap((child) => typeof child === 'string' ? [] : [child])
  const scoped = (text: string) => regions.find((region) => region.children.some((child) => typeof child === 'string' && child.includes(text)))!
  const shipping = PORTS.filter((port) => !port.parentLibrary && productAvailable(port, 'mcp')).map((port) => port.slug)
  const without = PORTS.filter((port) => !port.parentLibrary && !productAvailable(port, 'mcp')).map((port) => port.slug)
  expect([...scoped('MCP contracts').ports!].sort()).toEqual([...shipping, 'root'].sort())
  expect([...scoped('Fetch the guides together').ports!].sort()).toEqual(without.sort())
})
