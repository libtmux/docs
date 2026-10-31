import { describe, expect, it } from 'vitest'
import { tokenizeDoc } from '../src/doc/roles.ts'
import { isFilePath, SymbolIndex } from '../src/link.ts'
import { neverLinks } from '../src/never-links.ts'
import type { ApiSymbol } from '../src/model.ts'

const symbol = (id: string): ApiSymbol => ({
  id, publicId: id, name: id.split('.').at(-1)!, kind: 'class',
  modifiers: [], signatures: [], source: { file: 'types.ts' },
})

describe('fenced code in doc text', () => {
  const fence = (body: string) => `\`\`\`text\n${body}\n\`\`\``

  it('is literal: the backticks of a fence, and the code between two fences, pair with nothing around them', () => {
    const text = `Before.\n\n${fence("'shell_command': ['htop']")}\n\ntmuxp allows it to be simply a string:\n\n${fence("'shell_command': 'htop'")}\n\nAfter \`Pane\`.`
    const spans = tokenizeDoc(text, 'py')
    expect(spans.filter((span) => span.kind !== 'text')).toEqual([{ kind: 'ref', role: 'any', target: 'Pane', label: 'Pane' }])
    const literal = spans.filter((span) => span.kind === 'text').map((span) => span.text).join('')
    expect(literal).toContain(fence("'shell_command': ['htop']"))
    expect(literal).toContain('simply a string:')
    expect(literal).toContain(fence("'shell_command': 'htop'"))
  })

  it('leaves a tilde fence, an unclosed fence and text without a fence as they were', () => {
    expect(tokenizeDoc('~~~\n`Pane`\n~~~\nThen `Window`.', 'py').filter((span) => span.kind === 'ref')).toEqual([{ kind: 'ref', role: 'any', target: 'Window', label: 'Window' }])
    expect(tokenizeDoc('Use `Pane`.\n```\n`Window`', 'py').filter((span) => span.kind === 'ref')).toEqual([{ kind: 'ref', role: 'any', target: 'Pane', label: 'Pane' }])
    expect(tokenizeDoc('A `Pane` and a `Window`.', 'py').filter((span) => span.kind === 'ref')).toHaveLength(2)
  })
})

describe('doc spans', () => {
  const index = new SymbolIndex([symbol('pane.Pane')], (item) => `/${item.id}/`, 'ts')

  it('gives the linked parts of the literal of a reference that resolves nowhere, as the page renders them', () => {
    const [, span] = index.docSpans('See `Pane | Map<string, Pane>`.')
    expect(span).toMatchObject({ kind: 'ref', label: 'Pane | Map<string, Pane>' })
    expect('link' in span && span.link).toBeFalsy()
    expect('parts' in span && span.parts?.some((part) => part.link)).toBe(true)
  })

  it('never links a variable or the text a program prints, in the tokenizer every path calls', () => {
    expect(neverLinks('$SocketPath')).toBe('a variable')
    expect(neverLinks(' $control ')).toBe('a variable')
    expect(neverLinks('[object Object]')).toBe('text a program prints')
    expect(neverLinks('Pane')).toBeUndefined()
    expect(neverLinks('$')).toBeUndefined()
    expect(neverLinks('[object Object] and more')).toBeUndefined()
    const powershell = new SymbolIndex([symbol('LibTmux.Server')], (item) => `/${item.id}/`, 'powershell')
    for (const text of ['$Server', '[object Object]', '[object Array]']) {
      expect(index.linkType(text), text).toEqual([{ text }])
      expect(powershell.linkType(text), text).toEqual([{ text }])
      expect(powershell.linkLiteral(text), text).toEqual([{ text }])
    }
    expect(powershell.resolve('[object Object]')).toBeUndefined()
  })

  it('leaves the text a program prints as plain code: [object Object] names no type', () => {
    const [, span] = index.docSpans('The default is `[object Object]`.')
    expect(span).toMatchObject({ kind: 'ref', label: '[object Object]' })
    expect('parts' in span && span.parts).toEqual([{ text: '[object Object]' }])
    expect(index.linkLiteral('[object Object]')).toEqual([{ text: '[object Object]' }])
  })
})

describe('a path in plain Rust code', () => {
  const field = (id: string, kind: ApiSymbol['kind']): ApiSymbol => ({ ...symbol(id), kind })
  const symbols = [field('server.Server', 'struct'), field('server.Server.kill', 'method'), field('text.TmuxText', 'struct')]
  const index = new SymbolIndex(symbols, (item) => `/${item.id}/`, 'rs')
  const refs = (text: string, lang = 'rs') => tokenizeDoc(text, lang).filter((span) => span.kind === 'ref')

  it('links the item it names, as the bracketed path does', () => {
    const [plain] = index.docSpans('`Server::kill` stops its daemon.')
    expect(plain).toMatchObject({ kind: 'ref', target: 'Server.kill', label: 'Server::kill', link: { href: '/server.Server.kill/' } })
    const [bracketed] = index.docSpans('[`Server::kill`] stops its daemon.')
    expect('link' in bracketed && bracketed.link?.href).toBe('/server.Server.kill/')
  })

  it('resolves a crate path and a path on the current type the way the bracketed form does', () => {
    expect(refs('`crate::server::Server::kill`')).toMatchObject([{ target: 'server.Server.kill', label: 'crate::server::Server::kill' }])
    expect(refs('`Self::kill`')).toMatchObject([{ target: '.kill', label: 'Self::kill' }])
    // A path may climb more than one module, which a signature's `linkType` strips with the same pattern.
    expect(refs('`super::super::server::Server::kill`')).toMatchObject([{ target: 'server.Server.kill', label: 'super::super::server::Server::kill' }])
  })

  it('leaves a call, an expression and a bare name as written', () => {
    for (const text of ['TmuxText::from(value)', 'Server::kill()', 'Server::<Pane>::kill', 'Server::kill::', 'Server']) {
      expect(refs(`\`${text}\``), text).toEqual([{ kind: 'ref', role: 'any', target: text, label: text }])
    }
  })

  it.each(['cxx', 'py', 'ts', 'go'])('does not change the target in %s, whose `::` is not a Rust path', (lang) => {
    expect(refs('`Server::kill`', lang)).toEqual([{ kind: 'ref', role: 'any', target: 'Server::kill', label: 'Server::kill' }])
  })
})

describe('a literal that names a call or a path', () => {
  const field = (id: string, kind: ApiSymbol['kind']): ApiSymbol => ({ ...symbol(id), kind })
  const symbols = [
    field('text.TmuxText', 'struct'),
    field('pane.Pane', 'class'),
    field('pane.Pane.value', 'attribute'),
    field('pane.Pane.close', 'method'),
    field('spec.SessionSpec', 'class'),
  ]
  const href = (item: ApiSymbol) => `/${item.id}/`
  const index = new SymbolIndex(symbols, href, 'rs')
  /** Each span's text, with a linked one in brackets: `[TmuxText]::from(value)`. */
  const shape = (text: string, from = index) => from.linkLiteral(text).map((span) => (span.link ? `[${span.text}]` : span.text)).join('')

  it('links what a call calls and leaves its arguments the caller\'s own', () => {
    // The whole expression links `value` to the unrelated field of that name; a call's arguments do not.
    expect(index.linkType('TmuxText::from(value)').some((span) => span.text === 'value' && span.link)).toBe(true)
    expect(shape('TmuxText::from(value)')).toBe('[TmuxText]::from(value)')
  })

  it('links a callee that resolves whole and keeps the arguments plain', () => {
    expect(shape('pane.Pane.close(value)')).toBe('[pane.Pane.close](value)')
    expect(index.linkLiteral('pane.Pane.close(value)').map((span) => span.text).join('')).toBe('pane.Pane.close(value)')
  })

  it('keeps an argument that names a type, a builtin or a qualified member', () => {
    expect(shape('TmuxText::from(Pane)')).toBe('[TmuxText]::from([Pane])')
    expect(shape('get(String)')).toBe('get([String])')
    expect(shape('sort(panes, {}, Pane.value)')).toBe('sort(panes, {}, [Pane.value])')
    expect(shape('Pane#close(SessionSpec)', new SymbolIndex(symbols, href, 'java'))).toBe('[Pane]#[close]([SessionSpec])')
  })

  it('keeps the member that a chained call reaches', () => {
    expect(shape('Pane.close().value', new SymbolIndex(symbols, href, 'py'))).toBe('[Pane.close]().[value]')
    expect(shape('Pane::close().value')).toBe('[Pane]::close().[value]')
  })

  it('links the longest prefix that names a type when the whole path names nothing', () => {
    expect(shape('TmuxText::from')).toBe('[TmuxText]::from')
    expect(shape('TmuxText::from::inner')).toBe('[TmuxText]::from::inner')
    expect(index.linkLiteral('TmuxText::from')[0]?.link?.symbol?.id).toBe('text.TmuxText')
  })

  it.each([['rs', 'value::len'], ['py', 'value.len']] as const)('never links a prefix that is not a type in %s: a variable could match an unrelated field', (lang, text) => {
    expect(shape(text, new SymbolIndex(symbols, href, lang))).toBe(text)
  })

  it('leaves a control-mode marker plain, though the word after the percent sign names a member', () => {
    const named = new SymbolIndex([...symbols, field('capture.CaptureOptions.end', 'attribute')], href, 'rs')
    // `end` alone still links; `%end` is the protocol line that closes a reply and links nothing.
    expect(shape('end', named)).toBe('[end]')
    for (const marker of ['%end', '%begin', '%output', '%session-changed']) expect(shape(marker, named), marker).toBe(marker)
  })

  it('leaves a path whose prefixes name nothing plain', () => {
    expect(shape('nothing::from(value)')).toBe('nothing::from(value)')
  })

  describe('a kebab-case word', () => {
    const named = new SymbolIndex([...symbols, field('access.AccessRule.mode', 'attribute'), field('pane.Pane.activity', 'attribute'), field('server.Server.session', 'method')], href, 'rs')

    it('is one name, though a word in it names a member: `control-mode` is a Cargo feature, not `control` minus `mode`', () => {
      expect(shape('mode', named)).toBe('[mode]')
      for (const word of ['control-mode', 'unstable-fuzzing', 'monitor-activity', 'new-session', 'a-b-c', 'v2-mode', 'mode-2']) expect(shape(word, named), word).toBe(word)
      expect(named.linkLiteral('control-mode')).toEqual([{ text: 'control-mode' }])
    })

    // Each still links the member its `mode` names: only a lowercase word joined by single hyphens is one name.
    it.each(['Control-mode', 'control-mode()', '--control-mode', '-mode', 'mode-', 'control--mode', 'control-mode value'])('leaves %s to the linker', (text) => {
      expect(shape(text, named)).toContain('[mode]')
      expect(named.linkLiteral(text).map((span) => span.text).join('')).toBe(text)
    })

    it('keeps a capitalised PowerShell cmdlet a link, and the words of a lowercase one plain', () => {
      const cmdlets = new SymbolIndex([field('LibTmux.Get-TmuxServer', 'function'), field('LibTmux.Server', 'class')], href, 'powershell')
      expect(shape('Get-TmuxServer', cmdlets)).toBe('[Get-TmuxServer]')
      expect(shape('Get-TmuxServer -Name', cmdlets)).toBe('[Get-TmuxServer] -Name')
      expect(shape('get-tmuxserver', cmdlets)).toBe('get-tmuxserver')
    })
  })
})

describe('a literal that names no member of the symbol it is written in', () => {
  const field = (id: string, kind: ApiSymbol['kind'], parent?: string): ApiSymbol => ({ ...symbol(id), kind, ...(parent ? { parent } : {}) })
  const symbols = [
    field('mcp.Main', 'class'), field('mcp.Main.main', 'method', 'mcp.Main'),
    field('server.Server', 'class'), field('server.Server.main', 'method', 'server.Server'),
    field('server.Server.sessions', 'method', 'server.Server'), field('server.Server.windows', 'method', 'server.Server'),
    field('server.Server.pane_current_path', 'attribute', 'server.Server'),
    field('server.Server.Builder', 'class', 'server.Server'), field('server.Server.Builder.build', 'method', 'server.Server.Builder'),
    field('test.TestServer', 'class'), field('test.TestServer.server', 'method', 'test.TestServer'),
    field('model.OptionArgs', 'class'), field('model.OptionArgs.scope', 'attribute', 'model.OptionArgs'),
    field('cursor.Cursor', 'class'), field('cursor.Cursor.pane', 'method', 'cursor.Cursor'),
    field('cursor.Cursor.send_keys', 'method', 'cursor.Cursor'), field('cursor.Cursor.sendKeys', 'method', 'cursor.Cursor'),
    field('cursor.Cursor.Wait', 'constant', 'cursor.Cursor'),
    field('util', 'module'), field('util.helper', 'function', 'util'),
  ]
  const href = (item: ApiSymbol) => `/${item.id}/`
  const index = new SymbolIndex(symbols, href, 'rs')
  const at = (id: string) => symbols.find((item) => item.id === id)!
  const scope = at('model.OptionArgs.scope')
  /** Each span's text, with a linked one in brackets: `src/[main]`. */
  const shape = (text: string, context?: ApiSymbol, from = index) => from.linkLiteral(text, context).map((span) => (span.link ? `[${span.text}]` : span.text)).join('')

  describe('a file path', () => {
    const windows = at('server.Server.windows')

    it('links nothing in a path with a file extension, though a directory or file in it is named like a member', () => {
      // `main` is a method of the type being documented, so only the path keeps it from linking.
      expect(shape('main', windows)).toBe('[main]')
      for (const path of ['src/main/java/ListWindows.java', 'src/main.rs', 'benches/waits.rs', 'docs/design/main-notes.md', './examples/main.kt']) {
        expect(shape(path, windows), path).toBe(path)
        expect(index.linkLiteral(path, windows), path).toEqual([{ text: path }])
      }
    })

    it('links nothing in a directory under a source root, which has no extension', () => {
      for (const path of ['include/main/', 'src/main', 'lib/main/server', 'Sources/main']) expect(shape(path, windows), path).toBe(path)
    })

    it('still links a name with a slash that is no path: an extension or a source root is what makes one', () => {
      expect(shape('windows/sessions', windows)).toBe('[windows]/[sessions]')
      expect(shape('main/rest', windows)).toBe('[main]/rest')
    })

    it('reads a file by its extension, and a qualified name that ends in a member as no file', () => {
      for (const path of ['src/main/java/ListWindows.java', 'crates/libtmux/src/pane.rs', 'a/b/config.toml', '~/.tmux.conf', '#{pane_current_path}/foo.txt', 'include/libtmux/']) {
        expect(isFilePath(path), path).toBe(true)
      }
      // Go and Swift write a member after a slash-separated path; a URL is an address, not a file.
      for (const name of ['net/http.Client', 'os/exec.Command', 'Server/Direction.up', 'OutputWait/Outcome/stopped', 'https://example.com/a/b.html', 'name/arity', 'a/b']) {
        expect(isFilePath(name), name).toBe(false)
      }
    })

    it('links nothing in a path that holds a tmux format, since the format names no member of the type being documented', () => {
      // The member exists on the type being documented, so only the path keeps it from linking.
      expect(shape('pane_current_path', windows)).toBe('[pane_current_path]')
      expect(shape('#{pane_current_path}/foo.txt', windows)).toBe('#{pane_current_path}/foo.txt')
    })

    it('reads a path the page renders from a reference that resolves nowhere', () => {
      const [, span] = index.docSpans('Save this as `src/main/java/ListWindows.java` first.', windows)
      expect(span).toMatchObject({ kind: 'ref', label: 'src/main/java/ListWindows.java' })
      expect('parts' in span && span.parts).toEqual([{ text: 'src/main/java/ListWindows.java' }])
    })
  })

  describe('a plain lowercase word that is the short name of a member of another type', () => {
    it('links nothing: `server` and `pane` in a scope\'s docs are tmux words, not TestServer::server or Cursor::pane', () => {
      const [, server, , pane] = index.docSpans('One of `server` or `pane`.', scope)
      for (const [word, span] of [['server', server], ['pane', pane]] as const) {
        expect(span, word).toMatchObject({ kind: 'ref', label: word })
        expect('link' in span && span.link, word).toBeUndefined()
        expect('parts' in span && span.parts, word).toEqual([{ text: word }])
      }
      expect(index.linkLiteral('server', scope)).toEqual([{ text: 'server' }])
      expect(index.linkLiteral('pane()', scope).some((span) => span.link)).toBe(false)
    })

    it('links nothing for the word inside a longer literal either, unless a qualifier says whose it is', () => {
      expect(shape('server exited unexpectedly', scope)).toBe('server exited unexpectedly')
      expect(shape('tmux -L pane', scope)).toBe('tmux -L pane')
      expect(shape('Cursor.pane', scope)).toBe('[Cursor.pane]')
    })

    it('keeps an identifier, though its member belongs to another type: an underscore, an inner capital or a qualifier says which', () => {
      expect(shape('send_keys', scope)).toBe('[send_keys]')
      expect(shape('sendKeys', scope)).toBe('[sendKeys]')
      expect(shape('Wait', scope)).toBe('[Wait]')
      const [, span] = index.docSpans('Call `send_keys` or `sendKeys`.', scope)
      expect(span).toMatchObject({ kind: 'ref', label: 'send_keys', link: { symbol: { id: 'cursor.Cursor.send_keys' } } })
      expect(index.docSpans('Call `send_keys()`.', scope)[1]).toMatchObject({ link: { symbol: { id: 'cursor.Cursor.send_keys' } } })
    })

    it('keeps the members of the type being documented and of the types that enclose it', () => {
      expect(shape('sessions', at('server.Server.windows'))).toBe('[sessions]')
      expect(shape('sessions', at('server.Server'))).toBe('[sessions]')
      expect(index.docSpans('Call `sessions`.', at('server.Server.windows')).some((span) => span.kind === 'ref' && span.link?.symbol?.id === 'server.Server.sessions')).toBe(true)
      expect(shape('sessions', at('server.Server.Builder.build'))).toBe('[sessions]')
    })

    it('keeps a word when nothing says where it is written, a type, and a module\'s function', () => {
      expect(shape('server')).toBe('[server]')
      expect(shape('Cursor', scope)).toBe('[Cursor]')
      expect(shape('helper', scope)).toBe('[helper]')
    })

    it('keeps the other type\'s member when the reference names its type', () => {
      const [, span] = index.docSpans('See `Cursor.pane`.', scope)
      expect(span).toMatchObject({ kind: 'ref', link: { symbol: { id: 'cursor.Cursor.pane' } } })
    })
  })
})

describe('a plain word that names a member of a type the page is about', () => {
  const field = (id: string, kind: ApiSymbol['kind'], parent?: string, type?: string): ApiSymbol => ({ ...symbol(id), kind, ...(parent ? { parent } : {}), ...(type ? { type } : {}) })
  const callable = (id: string, kind: ApiSymbol['kind'], parent: string | undefined, returns?: string): ApiSymbol =>
    ({ ...field(id, kind, parent), signatures: [{ params: [], ...(returns ? { returns } : {}) }] })
  const symbols = [
    field('rt.Runtime', 'class'),
    callable('rt.Runtime.wait_ready', 'method', 'rt.Runtime', 'ReadyStatus'),
    callable('rt.Runtime.close', 'method', 'rt.Runtime', 'Shutdown'),
    field('rt.ReadyStatus', 'enum'), field('rt.ReadyStatus.closed', 'constant', 'rt.ReadyStatus'),
    field('rt.Shutdown', 'struct'), field('rt.Report', 'struct'),
    field('rt.Server', 'class'),
    callable('rt.Server.run', 'method', 'rt.Server', 'Result<String, Failure>'),
    field('rt.Failure', 'struct'), field('rt.Failure.kind', 'attribute', 'rt.Failure', 'FailureKind'),
    field('rt.FailureKind', 'enum'), field('rt.FailureKind.truncated', 'constant', 'rt.FailureKind'),
    field('rt.Other', 'class'), callable('rt.Other.poke', 'method', 'rt.Other'),
    field('rt.Options', 'struct'), field('rt.Options.implementation', 'attribute', 'rt.Options', 'Implementation'),
    field('rt.Implementation', 'enum'), field('rt.Implementation.tmux', 'constant', 'rt.Implementation'),
    callable('lib.snapshot', 'function', undefined), field('lib.Snapshot', 'struct'), field('lib.Snapshot.acquired', 'attribute', 'lib.Snapshot'),
    callable('lib.other', 'function', undefined),
  ]
  const index = new SymbolIndex(symbols, (item) => `/${item.id}/`, 'rs')
  const at = (id: string) => symbols.find((item) => item.id === id)!
  const shape = (text: string, id: string) => index.linkLiteral(text, at(id)).map((span) => (span.link ? `[${span.text}]` : span.text)).join('')

  it('keeps the member of a type that the page\'s own signature returns: `wait_ready` returns the `ReadyStatus` that `closed` belongs to', () => {
    expect(shape('closed', 'rt.Runtime.wait_ready')).toBe('[closed]')
    expect(index.docSpans('Reports `closed` once shut.', at('rt.Runtime.wait_ready')).some((span) => span.kind === 'ref' && span.link?.symbol?.id === 'rt.ReadyStatus.closed')).toBe(true)
    // The same word on a page with no such signature is the other type\'s by name alone.
    expect(shape('closed', 'rt.Other.poke')).toBe('closed')
  })

  it('keeps the member of a type that a returned type holds: `run` returns a `Failure` whose `kind` is a `FailureKind`', () => {
    expect(shape('truncated', 'rt.Server.run')).toBe('[truncated]')
    expect(shape('truncated', 'rt.Other.poke')).toBe('truncated')
  })

  it('keeps the member of a type that a type holds: `Options` has an `implementation` whose value `tmux` is named', () => {
    expect(shape('tmux', 'rt.Options')).toBe('[tmux]')
    expect(shape('tmux', 'rt.Report')).toBe('tmux')
  })

  it('keeps the member that gives back the page\'s own type: `Runtime::close` returns the `Shutdown` being documented', () => {
    expect(shape('close', 'rt.Shutdown')).toBe('[close]')
    expect(shape('close', 'rt.Report')).toBe('close')
  })

  it('keeps the field of the type a function is named for: `snapshot` builds a `Snapshot`', () => {
    expect(shape('acquired', 'lib.snapshot')).toBe('[acquired]')
    expect(shape('acquired', 'lib.other')).toBe('acquired')
  })
})
