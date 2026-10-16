import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readInventory } from '@libtmux/api-model'
import { API_MODELS, createApiIndex, indexFor } from '../src/lib/api-models'
import { productApiIndex } from '../src/lib/product-api'
import { createProseLinker } from '../src/lib/prose-resolver'

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
  it('links PowerShell commands, pipeline objects, common parameters, and variables', () => {
    const model = API_MODELS.powershell
    const command = model.symbols.find((symbol) => symbol.name === 'Connect-TmuxServer')!
    const index = indexFor(model, href)
    const signature = command.signatures[0]
    const spans = index.linkType(signature.raw!, command, signature)
    expect(spans.map((span) => span.text).join('')).toBe(signature.raw)
    expect(spans.find((span) => span.text === 'Connect-TmuxServer')).toMatchObject({ declaration: true })
    expect(spans.find((span) => span.text === 'Server')?.link?.href).toContain('.parameter.Server')
    expect(spans.find((span) => span.text === 'LibTmux.Server')?.link?.href).toContain('/csharp/latest/reference/')
    const prose = index.linkText('Use Get-TmuxSnapshot with LibTmux.Server and -ErrorAction. The example uses $SocketPath.', command)
    const refs = prose.filter((span) => span.kind === 'ref')
    expect(refs.map((span) => span.target)).toEqual(['Get-TmuxSnapshot', 'LibTmux.Server', '-ErrorAction', '$SocketPath'])
    expect(refs.every((span) => span.link)).toBe(true)
    expect(refs.at(-1)?.link?.href).toContain('about_variables')
    for (const [name, path] of [
      ['System.Management.Automation.SwitchParameter', 'system.management.automation.switchparameter?view=powershellsdk-7.4.0'],
      ['System.Management.Automation.ActionPreference', 'system.management.automation.actionpreference?view=powershellsdk-7.4.0'],
      ['System.String', 'system.string'], ['System.Nullable', 'system.nullable-1'],
    ]) expect(index.resolve(name)?.href).toBe(`https://learn.microsoft.com/dotnet/api/${path}`)
  })
  it('links Julia standard types and typed parameters within their own language', () => {
    const model = API_MODELS.julia
    const alias = model.symbols.find((symbol) => symbol.id === 'LibTmux.SessionID')!
    const index = indexFor(model, href)
    for (const [name, path] of [
      ['AbstractString', 'strings/#Core.AbstractString'], ['Any', 'base/#Core.Any'],
      ['Int64', 'numbers/#Core.Int64'], ['Bool', 'numbers/#Core.Bool'],
      ['String', 'strings/#Core.String-Tuple%7BAbstractString%7D'],
    ]) {
      expect(index.resolve(name)?.href).toBe(`https://docs.julialang.org/en/v1/base/${path}`)
      expect(indexFor(API_MODELS.py, href).resolve(name)?.href ?? '').not.toContain('docs.julialang.org')
    }
    for (const signature of alias.signatures) {
      const spans = index.linkType(signature.raw!, alias, signature)
      expect(spans.map((span) => span.text).join('')).toBe(signature.raw)
      for (const parameter of signature.params) {
        if (parameter.type === 'AbstractString') expect(spans.find((span) => span.text === 'AbstractString')?.link?.href)
          .toBe('https://docs.julialang.org/en/v1/base/strings/#Core.AbstractString')
      }
    }
    expect(index.resolve('MissingJuliaType')).toBeUndefined()
  })
  it('links Kotlin prose, parameters and each declared call-chain step', () => {
    const model = API_MODELS.kotlin
    const member = model.symbols.find((symbol) => symbol.id === 'io.github.libtmux.kotlin.Server.liveState')!
    const index = indexFor(model, href)
    const targets = Object.fromEntries(index.linkType(member.signatures[0].raw!, member)
      .filter((span) => span.link).map((span) => [span.text, span.link!.href]))
    expect(targets.config).toContain('Server.config')
    expect(targets.defaultTimeout).toContain('/java/latest/reference/io-github-libtmux-serverconfig-serverconfig-defaulttimeout/')
    expect(targets.toKotlinDuration).toContain('/kotlin.time/to-kotlin-duration.html')
    expect(targets.scope).toContain('.parameter.scope')
    expect(targets.CoroutineScope).toContain('/kotlinx.coroutines/-coroutine-scope/')
    expect(targets.Duration).toContain('/kotlin.time/-duration/')
    expect(targets.StateFlow).toContain('/kotlinx.coroutines.flow/-state-flow/')
    for (const name of ['CoroutineDispatcher', 'Dispatchers.IO']) {
      expect(index.resolve(name, 'any', member)?.href, name).toContain('/kotlinx.coroutines/')
    }
    for (const name of ['server', 'scope', 'StateFlow', 'launch', 'finally', 'suspend']) {
      expect(index.linkText('`' + name + '`', member)[0].link, name).toBeDefined()
    }
    expect(index.resolve('nonexistent.defaultTimeout', 'any', member)).toBeUndefined()
  })

  it('links Scala imports to Cats Effect and the parent Java reference', () => {
    const model = API_MODELS.scala
    const member = model.symbols.find((symbol) => symbol.id === 'io.github.libtmux.scaladsl.cats.LiveServer')!
    const index = indexFor(model, href)
    expect(index.resolve('Deferred', 'any', member)?.href).toContain('/cats/effect/kernel/Deferred.html')
    expect(index.resolve('Signal', 'any', member)?.href).toContain('/fs2-core_3/3.13.0/fs2/concurrent/Signal.html')
    expect(index.resolve('io.github.libtmux.snapshot.ServerMirror', 'any', member)?.href)
      .toContain('/java/latest/reference/io-github-libtmux-snapshot-servermirror-servermirror/')
    expect(index.resolve('Handles.scala', 'any', member)?.href).toMatch(/github\.com\/libtmux\/libtmux-java\/blob\/[a-f0-9]{40}\/libtmux-scala-cats\/src\/main\/scala\/.*\/Handles\.scala$/)
    for (const prefix of ['io.github.libtmux.scaladsl', 'io.github.libtmux.scaladsl.cats']) {
      const server = model.symbols.find((symbol) => symbol.id === `${prefix}.Server`)!
      expect(index.resolve('Window', 'class', server)?.symbol?.id).toBe(`${prefix}.Window`)
      expect(index.resolve(`${prefix}.Server#sessions`, 'any', server)?.symbol?.id).toBe(`${prefix}.Server.sessions`)
    }
    const server = model.symbols.find((symbol) => symbol.id === 'io.github.libtmux.scaladsl.Server')!
    expect(server.extends).toEqual(['AutoCloseable'])
    expect(index.resolve('close()', 'any', server)?.href)
      .toBe('https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/AutoCloseable.html#close()')
  })
  it('links a JDK type from a Java annotation', () => {
    const index = indexFor(API_MODELS.java, href)
    const hit = index.resolve('List', 'class')
    expect(hit?.external, 'List should resolve into the JDK').toBe(true)
    expect(hit?.href).toContain('docs.oracle.com')
  })

  it('uses each JDK package owner for Java, Kotlin and Scala references', () => {
    const base = 'https://docs.oracle.com/en/java/javase/21/docs/api/'
    const cases = [
      ['java.lang.AutoCloseable', 'java.base/java/lang/AutoCloseable.html'],
      ['AutoCloseable.close', 'java.base/java/lang/AutoCloseable.html#close()'],
      ['java.lang.AutoCloseable.close', 'java.base/java/lang/AutoCloseable.html#close()'],
      ['java.net.http.HttpClient', 'java.net.http/java/net/http/HttpClient.html'],
      ['java.util.logging.Logger', 'java.logging/java/util/logging/Logger.html'],
      ['java.lang.management.ManagementFactory', 'java.management/java/lang/management/ManagementFactory.html'],
      ['java.util.Map.Entry', 'java.base/java/util/Map.Entry.html'],
      ['Map.Entry.getKey', 'java.base/java/util/Map.Entry.html#getKey()'],
      ['java.lang.instrument.Instrumentation', 'java.instrument/java/lang/instrument/Instrumentation.html'],
      ['java.util.prefs.Preferences', 'java.prefs/java/util/prefs/Preferences.html'],
    ]
    for (const port of ['java', 'kotlin', 'scala']) {
      const core = indexFor(API_MODELS[port], href)
      const product = productApiIndex(API_MODELS[port], 'latest')
      const prose = createProseLinker()
      for (const [name, path] of cases) {
        expect(core.resolve(name)?.href, `${port}: ${name}`).toBe(base + path)
        expect(product.resolve(name)?.href, `${port} product: ${name}`).toBe(base + path)
        expect(prose(name, { pagePort: port }), `${port} prose: ${name}`).toMatchObject({ kind: 'link', href: base + path })
      }
    }
    expect(indexFor(API_MODELS.py, href).resolve('AutoCloseable')?.href).toBeUndefined()
    expect(createProseLinker()('Server.open', { pagePort: 'kotlin' })).toMatchObject({
      kind: 'link', href: '/kotlin/latest/reference/io-github-libtmux-kotlin-server-companion-open/', external: false,
    })
    expect(createProseLinker()('Observation.close', { pagePort: 'scala' })).toMatchObject({
      kind: 'link', href: '/scala/latest/reference/io-github-libtmux-scaladsl-streaming-observation-close/', external: false,
    })
  })

  it('links a DOM interface from a TypeScript annotation', () => {
    const index = indexFor(API_MODELS.ts, href)
    const hit = index.resolve('AbortController', 'class')
    expect(hit?.external).toBe(true)
    expect(hit?.href).toContain('developer.mozilla.org/en-US/docs/Web/API/AbortController')
  })

  it('links TypeScript utilities to the Handbook in core, MCP signatures, and prose', () => {
    const model = API_MODELS.ts
    const symbol = model.symbols.find((entry) => entry.product === 'mcp' && entry.name === 'createTmuxMcpServer')!
    expect(symbol).toBeDefined()
    const core = indexFor(model, href)
    const product = productApiIndex(model, 'latest')
    const prose = createProseLinker('mcp')
    const utilityBase = 'https://www.typescriptlang.org/docs/handbook/utility-types.html#'
    const cases = [
      ['Readonly', 'readonlytype'], ['Record', 'recordkeys-type'],
      ['Partial', 'partialtype'], ['Pick', 'picktype-keys'], ['Omit', 'omittype-keys'],
      ['ReturnType', 'returntypetype'], ['ThisType', 'thistypetype'],
    ]
    for (const [name, fragment] of cases) {
      const target = utilityBase + fragment
      expect(core.resolve(name)?.href, name).toBe(target)
      expect(product.resolve(name, 'any', symbol)?.href, name).toBe(target)
      expect(prose(name, { pagePort: 'ts' }), name).toMatchObject({ kind: 'link', href: target, external: true })
    }
    const options = symbol.signatures[0].params.find((parameter) => parameter.name === 'options')!
    expect(options.type).toContain('Readonly<Record<')
    const spans = product.linkType(options.type!, symbol)
    for (const [name, fragment] of cases.slice(0, 2)) {
      expect(spans.find((span) => span.text === name)?.link?.href).toBe(utilityBase + fragment)
    }
    expect(product.resolve('Promise')?.href).toBe('https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise')
    expect(product.resolve('AbortController')?.href).toBe('https://developer.mozilla.org/en-US/docs/Web/API/AbortController')
    expect(product.resolve('MissingUtilityType')).toBeUndefined()
    expect(indexFor(API_MODELS.java, href).resolve('Readonly')?.href).toBeUndefined()
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
    for (const port of ['rs', 'go', 'csharp', 'cxx', 'swift'] as const) {
      const index = indexFor(API_MODELS[port], href)
      for (const name of ['List', 'AbortController', 'str', 'Optional']) {
        const hit = index.resolve(name, 'class')
        expect(hit?.href ?? '', `${port} resolved ${name} in another language`).not.toMatch(/docs\.python\.org|docs\.oracle\.com|developer\.mozilla\.org/)
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
        href: 'https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/file/Path.html',
      })
      const workspace = product.linkType(signature.returns!, reader).find((span) => span.text === 'Workspace')?.link
      expect(workspace?.href).toContain(`/java/${version}/workspace/reference/`)
      expect(productApiIndex(model, version)).toBe(product)
    }
    expect(core.linkType(signature.returns!, reader).find((span) => span.text === 'Workspace')?.link?.href).toMatch(/^#/)
  })

  it('links dependency types in real product signatures and keeps their language scope', () => {
    const cases = [
      ['rs', 'ErrorData', 'docs.rs/rmcp/3.1.2'],
      ['java', 'McpSyncServer', 'mcp-core/2.0.1'],
      ['csharp', 'IMcpServerBuilder', 'csharp.sdk.modelcontextprotocol.io'],
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
  it.each(['python', 'jdk', 'dom', 'julia'])('%s', (name) => {
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


it('resolves ReadOnly through its pinned dependency source and preserves local identity', () => {
  const model = API_MODELS.java
  const source = 'https://github.com/JetBrains/kotlin/blob/5687445832cd835b4509b9fbc264cdf1a8201093/libraries/tools/kotlin-annotations-jvm/src/kotlin/annotations/jvm/ReadOnly.java#L28'
  const index = createApiIndex(model, href)
  for (const name of ['ReadOnly', 'kotlin.annotations.jvm.ReadOnly']) {
    expect(index.resolve(name, 'class')).toMatchObject({ external: true, href: source, project: 'Kotlin JVM annotations source' })
  }
  const local = { id: 'example.ReadOnly', qualifiedName: 'example.ReadOnly', name: 'ReadOnly', kind: 'interface' as const, modifiers: [], signatures: [], source: { file: 'ReadOnly.java' } }
  const scoped = createApiIndex({ ...model, symbols: [...model.symbols, local] }, href)
  expect(scoped.resolve('ReadOnly', 'class', local)?.symbol?.id).toBe(local.id)
  expect(scoped.resolve('kotlin.annotations.jvm.ReadOnly', 'class', local)?.href).toBe(source)
  expect(createApiIndex(API_MODELS.go, href).resolve('kotlin.annotations.jvm.ReadOnly')).toBeUndefined()
  expect(index.resolve('MissingAnnotation', 'class')).toBeUndefined()
})
