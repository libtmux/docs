import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readInventory } from '@libtmux/api-model'
import { API_MODELS, indexFor } from '../src/lib/api-models'
import { productApiIndex } from '../src/lib/product-api'

/**
 * The federation is reachable from a build, not just from a unit test.
 *
 * `indexFor` used to resolve each `.inv` from `import.meta.url` and skip it
 * when `existsSync` said no. Under Vite that path moves, so the check failed
 * silently and no inventory was ever loaded in a build — Python's 6,253
 * external links were byte-identical with the inventory present and absent,
 * every one of them from a hand-written fallback table of 22 names. Nothing
 * reported it, because fewer links is not an error.
 *
 * This asserts through `indexFor` itself for that reason. A test that loads
 * the `.inv` directly passes in exactly the situation that was broken.
 */
const here = dirname(fileURLToPath(import.meta.url))
const invDir = join(here, '../src/data/inventories')
const href = (s: { publicId?: string; id: string }) => `#${s.publicId ?? s.id}`

describe('indexFor attaches the inventories', () => {
  it('links a JDK type from a Java annotation', () => {
    const index = indexFor(API_MODELS.java, href)
    const hit = index.resolve('List', 'class')
    expect(hit?.external, 'List should resolve into the JDK').toBe(true)
    expect(hit?.href).toContain('docs.oracle.com')
  })

  it('links a DOM interface from a TypeScript annotation', () => {
    const index = indexFor(API_MODELS.ts, href)
    const hit = index.resolve('AbortController', 'class')
    expect(hit?.external).toBe(true)
    expect(hit?.href).toContain('developer.mozilla.org/en-US/docs/Web/API/AbortController')
  })

  it('links a Python name the built-in fallback cannot reach', () => {
    // Deliberately a method on a builtin, not `dataclasses.dataclass`: the
    // fallback resolves anything whose first segment is a stdlib module name,
    // so most qualified names pass with or without the inventory and prove
    // nothing. `str.removeprefix` has no module head, so only the inventory
    // has it — this fails the moment the inventory stops loading again.
    const index = indexFor(API_MODELS.py, href)
    const hit = index.resolve('str.removeprefix', 'class')
    expect(hit?.external, 'str.removeprefix is inventory-only').toBe(true)
    expect(hit?.href).toContain('docs.python.org')
  })

  it('does not answer for a language it does not describe', () => {
    for (const port of ['rs', 'go', 'dotnet', 'cxx', 'swift'] as const) {
      const index = indexFor(API_MODELS[port], href)
      for (const name of ['List', 'AbortController', 'str', 'Optional']) {
        const hit = index.resolve(name, 'class')
        expect(hit?.external, `${port} resolved ${name} externally`).not.toBe(true)
      }
    }
  })

  it('links a workspace signature through the same inventories without sharing route caches', () => {
    const model = API_MODELS.java
    const reader = model.symbols.find((symbol) => symbol.product === 'workspace'
      && symbol.name === 'read' && symbol.source.file.endsWith('/WorkspaceBuilder.java'))!
    expect(reader, 'WorkspaceBuilder.read declaration').toBeDefined()
    const signature = reader.signatures[0]
    const annotation = signature.params.find((param) => param.name === 'file')!.type!
    const core = indexFor(model, href)
    for (const version of ['latest', 'stable']) {
      const product = productApiIndex(model, version)
      const external = product.linkType(annotation, reader).find((span) => span.text === 'Path')?.link
      expect(external, `${version} workspace file parameter`).toMatchObject({
        external: true,
        href: 'https://docs.oracle.com/en/java/javase/21/docs/api/java/nio/file/Path.html',
      })
      const workspace = product.linkType(signature.returns!, reader).find((span) => span.text === 'Workspace')?.link
      expect(workspace?.href).toContain(`/java/${version}/workspace/internals/api/`)
      expect(productApiIndex(model, version)).toBe(product)
    }
    expect(core.linkType(signature.returns!, reader).find((span) => span.text === 'Workspace')?.link?.href).toMatch(/^#/)
  })

  it('links dependency types in real product signatures and keeps their language scope', () => {
    const cases = [
      ['rs', 'ErrorData', 'docs.rs/rmcp/3.1.2'],
      ['java', 'McpSyncServer', 'mcp-core/2.0.1'],
      ['dotnet', 'ProgressNotificationValue', 'csharp.sdk.modelcontextprotocol.io'],
      ['py', 'FastMCP', 'gofastmcp.com'],
      ['ts', 'McpServer', 'typescript-sdk/blob/1.30.0'],
      ['go', 'sdk.Tool', 'go-sdk@v1.6.1'],
    ] as const
    for (const [port, name, target] of cases) {
      const model = API_MODELS[port]
      const symbol = model.symbols.find((entry) => entry.product === 'mcp'
        && entry.signatures.some((signature) => [signature.returns, ...signature.params.map((param) => param.type)]
          .some((annotation) => annotation?.includes(name))))!
      expect(symbol, `${port} signature names ${name}`).toBeDefined()
      const link = productApiIndex(model, 'latest').linkType(name, symbol)[0].link
      expect(link?.external, `${port} ${name}`).toBe(true)
      expect(link?.href).toContain(target)
      expect(indexFor(API_MODELS.swift, href).linkType(name)[0].link?.external).not.toBe(true)
    }
  })
})

describe('each sidecar agrees with the .inv beside it', () => {
  /**
   * Two files written from the same bytes in the same run, so they can only
   * drift if one is regenerated alone. The `.inv` is what Sphinx consumes and
   * what the round-trip tests validate; the sidecar is what the bundler can
   * see. Neither is redundant, so both are checked.
   */
  it.each(['python', 'jdk', 'dom'])('%s', (name) => {
    const inv = readInventory(readFileSync(join(invDir, `${name}.inv`)))
    const sidecar = JSON.parse(
      readFileSync(join(invDir, `${name}.entries.json`), 'utf8'),
    ) as { project: string; e: [string, string][] }

    expect(sidecar.e.length, `${name}: entry count differs`).toBe(inv.entries.length)
    expect(sidecar.project).toBe(inv.project)

    // Compared as multisets, not by name: an inventory may carry one name in
    // several domains — CPython has `__future__` as a module and as a label —
    // so a name-keyed map silently drops one and reports a false mismatch.
    const key = (n: string, u: string) => `${n}\u0000${u}`
    const fromInv = new Set(inv.entries.map((e) => key(e.name, e.uri)))
    const mismatched = sidecar.e.filter(([n, u]) => !fromInv.has(key(n, u)))
    expect(mismatched.slice(0, 3), `${name}: URIs differ`).toEqual([])
  })
})
