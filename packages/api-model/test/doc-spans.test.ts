import { describe, expect, it } from 'vitest'
import { tokenizeDoc } from '../src/doc/roles.ts'
import { SymbolIndex } from '../src/link.ts'
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
