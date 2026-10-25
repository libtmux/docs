import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ApiModel, ApiSymbol } from '../src/model.ts'
import { Resolver, notASymbol } from '../src/resolver.ts'
import { decideFilePath, decideMention, portFromSentence } from '../src/prose.ts'
import { pageMentions } from '../src/mentions.ts'
import { parentInventory } from '../src/parent-inventory.ts'
import { builtinHref } from '../src/builtins.ts'
import { extractWithSpec } from '../src/languages/spec.ts'
import { GO } from '../src/languages/specs.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const audit = (...args: string[]) => spawnSync(process.execPath, ['scripts/check-api-links.mjs', ...args, '--json'], { cwd: root, encoding: 'utf8' })

describe('product prose audit', () => {
  it('audits native commands and dependency types without accepting invented commands', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'libtmux-powershell-audit-'))
    const file = join(scratch, 'topic.md')
    try {
      writeFileSync(file, '---\ntitle: Snapshot\nport: powershell\n---\n\nUse `Get-TmuxSnapshot` with `LibTmux.Server`.\n')
      expect(audit(file).status).toBe(0)
      writeFileSync(file, '---\ntitle: Snapshot\nport: powershell\n---\n\nUse `Invent-TmuxSnapshot`.\n')
      const result = audit(file)
      expect(result.status).toBe(1)
      expect(JSON.parse(result.stdout).unresolved.map((entry: { text: string }) => entry.text)).toEqual(['Invent-TmuxSnapshot'])
    } finally {
      rmSync(scratch, { recursive: true })
    }
  })

  it('checks the product collection by default', () => {
    const result = audit()
    expect(JSON.parse(result.stdout).pages).toContain('ports/ts/mcp/index.md')
  })

  it('does not let another language satisfy an authored port reference', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'libtmux-prose-audit-'))
    const file = join(scratch, 'topic.md')
    try {
      writeFileSync(file, '---\ntitle: Capture\nport: ts\nproduct: mcp\n---\n\nUse `capture_pane()` for output.\n')
      const result = audit(file)
      expect(result.status).toBe(1)
      expect(JSON.parse(result.stdout).unresolved.map((entry: { text: string }) => entry.text)).toEqual(['capture_pane()'])
    } finally {
      rmSync(scratch, { recursive: true })
    }
  })
})

describe('product context in prose', () => {
  const symbols = [
    { id: 'tmux.Window', name: 'Window', kind: 'struct', product: 'core' },
    { id: 'tmux.Window.Open', name: 'Open', kind: 'method', parent: 'tmux.Window', product: 'core' },
    { id: 'workspace.Window', name: 'Window', kind: 'struct', product: 'workspace' },
    { id: 'workspace.Window.Open', name: 'Open', kind: 'method', parent: 'workspace.Window', product: 'workspace' },
    { id: 'tmux.Server', name: 'Server', kind: 'struct', product: 'core' },
    { id: 'tmux.Scope.Server', name: 'Server', kind: 'constant', parent: 'tmux.Scope', product: 'core' },
    { id: 'mcp.Target.Server', name: 'Server', kind: 'constant', parent: 'mcp.Target', product: 'mcp' },
    { id: 'mcp.Run', name: 'Run', kind: 'function', product: 'mcp' },
  ].map((s) => ({ ...s, signatures: [] })) as ApiSymbol[]
  const model = { port: 'go', version: '0', symbols } as ApiModel
  const resolver = new Resolver([model])
  const id = (text: string, product?: 'core' | 'workspace' | 'mcp') => {
    const result = resolver.resolve('go', text, product)
    return 'symbol' in result ? result.symbol.id : result.how
  }

  it('prefers the current product while preserving default core links', () => {
    expect(id('Window')).toBe('tmux.Window')
    expect(id('Window', 'workspace')).toBe('workspace.Window')
    expect(id('window.Open()', 'workspace')).toBe('workspace.Window.Open')
    expect(id('window.Open()')).toBe('tmux.Window.Open')
    expect(id('tmux.Window', 'workspace')).toBe('tmux.Window')
    expect(id('workspace.Window')).toBe('workspace.Window')
  })

  it('falls back to the core type without confusing it with enum members', () => {
    expect(id('Server', 'workspace')).toBe('tmux.Server')
    expect(id('Server', 'mcp')).toBe('tmux.Server')
    expect(id('tmux.Scope.Server', 'workspace')).toBe('tmux.Scope.Server')
  })

  it('does not borrow another language when the page already names its port', () => {
    const other = { port: 'py', version: '0', symbols: [{ id: 'Other', name: 'Other', kind: 'class', signatures: [] }] } as ApiModel
    for (const product of [undefined, 'workspace'] as const) {
      const result = decideMention('Other', { pagePort: 'go', product }, new Resolver([model, other]), { go: model, py: other })
      expect(result.kind).toBe('unresolved')
    }
  })

  it('links standard-library types through the existing language catalog', () => {
    const rust = { port: 'rs', version: '0', symbols: [] } as unknown as ApiModel
    expect(decideMention('BTreeMap', { pagePort: 'rs' }, new Resolver([rust]), { rs: rust }))
      .toMatchObject({ kind: 'link', port: 'rs', href: 'https://doc.rust-lang.org/std/collections/struct.BTreeMap.html', external: true })
  })

  it('links a bare word to the standard library of the build only where the page says its language', () => {
    const elixir = { port: 'elixir', version: '0', symbols: [] } as unknown as ApiModel
    const ask = (text: string, context: Parameters<typeof decideMention>[1]) => decideMention(text, context, new Resolver([elixir]), { elixir })
    expect(ask('timeout', { pagePort: 'elixir' })).toMatchObject({ kind: 'link', external: true })
    expect(ask('timeout', { pagePort: 'elixir', languageSaid: true })).toMatchObject({ kind: 'link', external: true })
    // A page shared by every port is rendered for Elixir too, and `timeout` in it is the coreutils command.
    expect(ask('timeout', { pagePort: 'elixir', languageSaid: false })).toMatchObject({ kind: 'skip' })
    // The sentence that names the port says it, whatever the page does.
    expect(ask('timeout', { pagePort: 'elixir', languageSaid: false, before: 'In Elixir, ' })).toMatchObject({ kind: 'link', external: true })
    // A name that carries its own evidence, a type or a qualified one, links on any page.
    const rust = { port: 'rs', version: '0', symbols: [] } as unknown as ApiModel
    expect(decideMention('BTreeMap', { pagePort: 'rs', languageSaid: false }, new Resolver([rust]), { rs: rust })).toMatchObject({ kind: 'link', external: true })
    // The library's own symbols are the page's to link in every build.
    const own = { port: 'rs', version: '0', symbols: [{ id: 'session', name: 'session', kind: 'function', signatures: [], source: { file: 'a.rs' } }] } as unknown as ApiModel
    expect(decideMention('session', { pagePort: 'rs', languageSaid: false }, new Resolver([own]), { rs: own })).toMatchObject({ kind: 'link', external: false })
  })

  it('names a port in a sentence by a whole word, and not by what code, a path or a URL contains', () => {
    expect(portFromSentence('In Java, ')).toBe('java')
    expect(portFromSentence('Python\'s checked wait is ')).toBe('py')
    expect(portFromSentence('In C++20 and ')).toBe('cxx')
    expect(portFromSentence('Go has ')).toBe('go')
    // JavaScript is not Java, an algorithm is not Go, and a trust is not Rust.
    expect(portFromSentence('JavaScript has a ')).toBeUndefined()
    expect(portFromSentence('An algorithm going to Google uses a trust of ')).toBeUndefined()
    expect(portFromSentence('lets go and ')).toBeUndefined()
    // The anchor of a file is not C#, and the words of a dotted name, a path or an address are not a language.
    expect(portFromSentence('Read options-table.c#L359 for the ')).toBeUndefined()
    expect(portFromSentence('the java.util.Set docs and ')).toBeUndefined()
    expect(portFromSentence('see https://docs.python.org/3/library/os.html and ')).toBeUndefined()
    expect(portFromSentence('under src/java/ and ')).toBeUndefined()
    expect(portFromSentence('Rust and Python differ, so ')).toBe('py')
  })

  it('resolves a Kotlin or Scala name to the language before the JDK inventory they share, as a symbol\'s docs do', () => {
    const kotlin = { port: 'kotlin', version: '0', symbols: [] } as unknown as ApiModel
    const scala = { port: 'scala', version: '0', symbols: [] } as unknown as ApiModel
    const java = { port: 'java', version: '0', symbols: [] } as unknown as ApiModel
    const resolver = new Resolver([kotlin, scala, java])
    resolver.addInventory('Java SE', 'https://docs.oracle.com/en/java/javase/21/docs/api/', [
      { name: 'Flow', uri: 'java.base/java/util/concurrent/Flow.html', type: 'std:label', priority: 1, dispname: '-' },
      { name: 'Vector', uri: 'java.base/java/util/Vector.html', type: 'std:label', priority: 1, dispname: '-' },
      { name: 'List', uri: 'java.base/java/util/List.html', type: 'std:label', priority: 1, dispname: '-' },
    ], ['java', 'kotlin', 'scala'])
    const models = { kotlin, scala, java }
    const href = (port: string, text: string) => {
      const found = decideMention(text, { pagePort: port }, resolver, models)
      return found.kind === 'link' ? found.href : found.kind
    }
    expect(href('kotlin', 'Flow')).toBe(builtinHref('kotlin', 'Flow'))
    expect(href('kotlin', 'List')).toBe(builtinHref('kotlin', 'List'))
    expect(href('scala', 'Vector')).toBe(builtinHref('scala', 'Vector'))
    expect(href('scala', 'List')).toBe(builtinHref('scala', 'List'))
    // Java's own sentences still reach the JDK.
    expect(href('java', 'Vector')).toBe('https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Vector.html')
    expect(href('kotlin', 'Flow')).not.toContain('docs.oracle.com')
  })

  it('keeps a Scala or Kotlin page\'s own language when its sentence says Java, and still follows a language the port does not reach', () => {
    const scala = { port: 'scala', version: '0', symbols: [] } as unknown as ApiModel
    const java = { port: 'java', version: '0', symbols: [] } as unknown as ApiModel
    const rust = { port: 'rs', version: '0', symbols: [] } as unknown as ApiModel
    const py = { port: 'py', version: '0', symbols: [] } as unknown as ApiModel
    const resolver = new Resolver([scala, java, rust, py])
    resolver.addInventory('Java SE', 'https://docs.oracle.com/en/java/javase/21/docs/api/', [
      { name: 'Vector', uri: 'java.base/java/util/Vector.html', type: 'std:label', priority: 1, dispname: '-' },
      { name: 'Flow', uri: 'java.base/java/util/concurrent/Flow.html', type: 'std:label', priority: 1, dispname: '-' },
      { name: 'Optional.of', uri: 'java.base/java/util/Optional.html#of(T)', type: 'std:label', priority: 1, dispname: '-' },
    ], ['java', 'scala'])
    const models = { scala, java, rs: rust, py }
    const href = (port: string, text: string, before: string) => {
      const found = decideMention(text, { pagePort: port, before }, resolver, models)
      return found.kind === 'link' ? found.href : found.kind
    }
    expect(href('scala', 'Vector', 'aliases of the Java ones, and return immutable ')).toBe(builtinHref('scala', 'Vector'))
    // The JDK\'s Flow is not the Ox Flow a Scala sentence means; a JDK method a Scala page names is the JDK\'s.
    expect(href('scala', 'Flow', 'an Ox ')).toBe('unresolved')
    expect(href('scala', 'Optional.of', 'different from ')).toBe('https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Optional.html#of(T)')
    // A name only the JDK has, in a sentence that says Java, is Java's: the link is credited to Java, where a bare name is read.
    const credited = (port: string, text: string, before: string) => {
      const found = decideMention(text, { pagePort: port, before }, resolver, models)
      return found.kind === 'link' ? found.port : found.kind
    }
    expect(credited('scala', 'Optional.of', 'the record\'s own Java accessor, ')).toBe('java')
    expect(credited('scala', 'Vector', 'aliases of the Java ones, and return immutable ')).toBe('scala')
    // A Java page that says Scala is about Scala, and a Python page that names Rust follows Rust.
    expect(href('java', 'Vector', 'In Java, ')).toBe('https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Vector.html')
    expect(portFromSentence('Rust\'s ')).toBe('rs')
  })

  it('links a variable or a printed object nowhere', () => {
    const rust = { port: 'rs', version: '0', symbols: [] } as unknown as ApiModel
    for (const text of ['$SocketPath', '$control.Windows[0]', '[object Object]', '[object Array]']) {
      expect(decideMention(text, { pagePort: 'rs' }, new Resolver([rust]), { rs: rust }), text).toMatchObject({ kind: 'skip' })
    }
  })

  it('uses the enclosing type to distinguish nested builders', () => {
    const java = { port: 'java', version: '0', symbols: ['SessionSpec', 'WindowSpec'].map((name) => ({
      id: `io.example.${name}.${name}.Builder.environment`, name: 'environment', kind: 'method', signatures: [],
    })) } as unknown as ApiModel
    const r = new Resolver([java])
    const found = r.resolve('java', 'SessionSpec.Builder.environment(Map)')
    expect('symbol' in found && found.symbol.id).toBe('io.example.SessionSpec.SessionSpec.Builder.environment')
    expect(r.resolve('java', 'Builder.environment(Map)').how).toBe('ambiguous')
  })

  it('classifies MCP resource URIs and newly authored filenames explicitly', () => {
    expect(notASymbol('tmux://sessions/{session_id}')).toBe('a protocol URI')
    expect(decideFilePath('dev.yaml', { before: 'Save this description as ' }, {})).toEqual({ kind: 'skip', why: 'file created by the example' })
    expect(decideFilePath('missing.yaml', { before: 'The implementation reads ' }, {}).kind).toBe('unresolved')
  })

  it('does not resolve a missing source path against another port', () => {
    const trees = { rs: new Set(['src/server.rs']), py: new Set(['src/libtmux/pane.py']) }
    expect(decideFilePath('src/libtmux/pane.py', { pagePort: 'rs' }, trees).kind).toBe('unresolved')
    expect(decideFilePath('src/libtmux/pane.py', { pagePort: 'rs', before: 'Python uses ' }, trees))
      .toMatchObject({ kind: 'link', port: 'py' })
    expect(decideFilePath('src/libtmux/pane.py', {}, trees)).toMatchObject({ kind: 'link', port: 'py' })
  })
})

describe('a Java-only libtmux symbol on a Kotlin or Scala page', () => {
  const symbol = (id: string, name: string) => ({ id, name, kind: 'class', signatures: [], source: { file: `${name}.java` } })
  const kotlin = { port: 'kotlin', version: '0', symbols: [symbol('io.example.Snapshot', 'Snapshot')] } as unknown as ApiModel
  const scala = { port: 'scala', version: '0', symbols: [symbol('io.example.Snapshot', 'Snapshot')] } as unknown as ApiModel
  const java = {
    port: 'java', version: '0',
    symbols: [symbol('io.example.PaneState', 'PaneState'), symbol('io.example.Snapshot', 'Snapshot')],
  } as unknown as ApiModel
  const models = { kotlin, scala, java }
  const jdk = ['Phaser', 'Flow', 'Vector'].map((name) => ({ name, uri: `java.base/java/util/concurrent/${name}.html`, type: 'std:label', priority: 1, dispname: '-' }))

  /** The inventories a Kotlin or Scala build holds: the parent library the port wraps, and the JDK's. The site and the generators name the first differently. */
  const resolverNamed = (parent: string) => {
    const resolver = new Resolver([kotlin, scala, java])
    resolver.addInventory(parent, '', parentInventory(java, (entry) => `/reference/java/${entry.name}/`), ['kotlin', 'scala'])
    resolver.addInventory('Java SE', 'https://docs.oracle.com/en/java/javase/21/docs/api/', jdk, ['java', 'kotlin', 'scala'])
    return resolver
  }
  const builds = ['Library API', 'libtmux Java']

  describe.each(builds)('where the parent library\'s inventory is named %s', (parent) => {
    const resolver = resolverNamed(parent)

    it.each(['kotlin', 'scala'])('credits the symbol to Java when the %s sentence says Java: the page\'s port holds only an inventory entry for it', (pagePort) => {
      for (const before of ['returning the real Java ', 'Wraps Java\'s ']) {
        expect(decideMention('PaneState', { pagePort, before }, resolver, models), before)
          .toMatchObject({ kind: 'link', port: 'java', external: false })
      }
    })

    it.each(['kotlin', 'scala'])('records the Java symbol as the %s page\'s backlink, and records nothing for a name Java lacks', (authoredPort) => {
      const mentioned = (body: string) => pageMentions({
        body, portByLabel: {}, page: `/${authoredPort}/latest/guides/state/`, authoredPort, nativeTmux: false, resolver, models, authoredTarget: () => undefined,
      }).targets
      expect(mentioned('Each call returns the real Java `PaneState` for the pane.\n')).toEqual([{ port: 'java', symbol: 'io.example.PaneState' }])
      expect(mentioned('Each call returns the real Java `Missing` for the pane.\n')).toEqual([])
    })

    it.each(['kotlin', 'scala'])('leaves the %s page its own symbols and curated names, and sends the JDK\'s names to Java', (pagePort) => {
      const said = { pagePort, before: 'the real Java ' }
      expect(decideMention('Snapshot', said, resolver, models)).toMatchObject({ kind: 'link', port: pagePort })
      expect(decideMention('Phaser', said, resolver, models)).toMatchObject({ kind: 'link', port: 'java' })
      // A curated name written as a call is still the port's, where the JDK's inventory holds the same word.
      const curated = pagePort === 'kotlin' ? 'Flow' : 'Vector'
      expect(decideMention(`${curated}()`, said, resolver, models)).toMatchObject({ kind: 'link', port: pagePort, href: builtinHref(pagePort, curated) })
    })
  })
})

it('extracts exported Go error variables with their source documentation', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'libtmux-go-api-'))
  const file = join(scratch, 'workspace.go')
  try {
    writeFileSync(file, 'package workspace\n\n// ErrInvalidWorkspace matches parse and validation failures.\nvar ErrInvalidWorkspace = errors.New("workspace: invalid workspace")\nvar privateError = errors.New("private")\n')
    const symbols = await extractWithSpec(GO, file, 'workspace')
    expect(symbols.map((symbol) => symbol.id)).toEqual(['workspace.ErrInvalidWorkspace'])
    expect(symbols[0].doc?.summary).toContain('parse and validation failures')
    expect(symbols[0].source?.line).toBe(4)
  } finally {
    rmSync(scratch, { recursive: true })
  }
})
