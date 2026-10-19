import { describe, expect, it } from 'vitest'
import { docSummaryText, tokenizeDoc } from '../src/doc/roles.ts'
import { SymbolIndex } from '../src/link.ts'
import type { ApiSymbol, Signature } from '../src/model.ts'

const symbol = (id: string): ApiSymbol => ({
  id, publicId: id, name: id.split('.').at(-1)!, kind: 'class',
  modifiers: [], signatures: [], source: { file: 'types.ts' },
})

/** Each linked span with where it goes: a type parameter's anchor, or a global declaration. */
const linked = (parts: ReturnType<SymbolIndex['linkType']>) =>
  parts.filter((part) => part.link).map((part) => [part.text, part.link!.href])

describe('inline code references', () => {
  it('keeps generic code intact before resolving each identifier', () => {
    const text = 'A `Selection<Pane>` preserves its handle.'
    expect(tokenizeDoc(text, 'ts')).toEqual([
      { kind: 'text', text: 'A ' },
      { kind: 'ref', role: 'any', target: 'Selection<Pane>', label: 'Selection<Pane>' },
      { kind: 'text', text: ' preserves its handle.' },
    ])
    expect(docSummaryText(text, 'ts')).toBe('A Selection<Pane> preserves its handle.')
  })

  it.each(['ts', 'java', 'cxx', 'kotlin', 'scala', 'csharp', 'rs', 'swift', 'go', 'julia', 'fsharp', 'ruby', 'lua', 'powershell'])
    ('preserves nested generic expressions in %s code', (port) => {
      const expression = 'Selection<Pair<handles.Pane, Missing>, "Pane">[]'
      const index = new SymbolIndex([
        symbol('selection.Selection'), symbol('other.Selection'), symbol('selection.Pair'), symbol('pane.Pane'), symbol('other.Pane'),
      ], (entry) => `/pr-42/en/${port}/v1/reference/${entry.id}/`, port)
      const context = { ...symbol('selection.WhereOf'), imports: { handles: 'pane' } }
      const [span] = index.linkText('`' + expression + '`', context)
      expect(span).toMatchObject({ kind: 'ref', label: expression, target: expression })
      expect(span.link).toBeUndefined()
      if (span.kind !== 'ref') throw new Error('The code expression must remain one reference span')
      const parts = index.linkType(span.label, context)
      expect(parts.map((part) => part.text).join('')).toBe(expression)
      expect(parts.filter((part) => part.link).map((part) => [part.text, part.link!.href])).toEqual([
        ['Selection', `/pr-42/en/${port}/v1/reference/selection.Selection/`],
        ['Pair', `/pr-42/en/${port}/v1/reference/selection.Pair/`],
        ['handles.Pane', `/pr-42/en/${port}/v1/reference/pane.Pane/`],
      ])
      expect(index.linkType('Selection<Pane, Missing>', context).find((part) => part.text === 'Pane')?.link).toBeUndefined()
      expect(index.linkType('Selection<missing.Pane>', context).find((part) => part.text === 'missing.Pane')?.link).toBeUndefined()
    })

  it('keeps a TypeScript type parameter distinct from imported and global names', () => {
    const owner = { ...symbol('selection.Filter'), typeParams: ['Pane'] }
    const context = { ...symbol('selection.Filter.pick'), parent: owner.id, imports: { Pane: 'pane.Pane' } }
    const index = new SymbolIndex([owner, context, symbol('selection.Selection'), symbol('pane.Pane')], (entry) => `/${entry.id}/`, 'ts')
    expect(linked(index.linkType('Selection<Pane>', context))).toEqual([
      ['Selection', '/selection.Selection/'], ['Pane', '/selection.Filter/#selection.Filter.type-parameter.Pane'],
    ])
    expect(linked(index.linkType('Selection<pane.Pane>', context)).map(([text]) => text)).toEqual(['Selection', 'pane.Pane'])
  })

  it.each(['Pane extends Model', 'const Pane extends Model', 'out Pane = Model'])
    ('recognizes the binding in a TypeScript parameter declaration: %s', (parameter) => {
      const context = { ...symbol('selection.pick'), signatures: [{ params: [], typeParams: [parameter] }] }
      const index = new SymbolIndex([context, symbol('selection.Selection'), symbol('pane.Pane'), symbol('types.Model')], (entry) => `/${entry.id}/`, 'ts')
      const anchor = '/selection.pick/#selection.pick.type-parameter.Pane'
      expect(linked(index.linkType('Selection<Pane>', context))).toEqual([['Selection', '/selection.Selection/'], ['Pane', anchor]])
      expect(linked(index.linkType(parameter, context))).toEqual([['Pane', anchor], ['Model', '/types.Model/']])
    })

  it('does not inherit type parameters from a sibling overload or constructor', () => {
    const generic: Signature = { params: [], typeParams: ['Pane'] }
    const concrete: Signature = { params: [{ name: 'value', type: 'Pane' }], returns: 'Pane' }
    const owner = { ...symbol('selection.Factory'), signatures: [generic] }
    const context = { ...symbol('selection.Factory.pick'), parent: owner.id, signatures: [generic, concrete] }
    const index = new SymbolIndex([owner, context, symbol('pane.Pane')], (entry) => `/${entry.id}/`, 'ts')
    expect(index.linkType('Pane', context, concrete)[0].link?.href).toBe('/pane.Pane/')
    expect(index.linkType('Pane', context, generic)[0].link?.href).toBe('/selection.Factory.pick/#selection.Factory.pick.type-parameter.Pane')
    expect(index.linkType('Pane', { ...context, signatures: [] })[0].link?.href).toBe('/pane.Pane/')
  })

  it.each([false, true])('keeps shared overload prose conservative when both overloads bind the name: %s', (bothGeneric) => {
    const generic: Signature = { params: [], typeParams: ['Pane extends Model'] }
    const other: Signature = { params: [{ name: 'value', type: 'Pane' }], ...(bothGeneric ? { typeParams: ['Pane extends Model'] } : {}) }
    const context = { ...symbol('selection.pick'), signatures: [generic, other] }
    const index = new SymbolIndex([context, symbol('selection.Selection'), symbol('pane.Pane')], (entry) => `/${entry.id}/`, 'ts')
    // Shared prose has no selected overload, so a name bound by either one stays out of the global lookup.
    expect(linked(index.linkType('Selection<Pane>', context)).map(([text]) => text)).toEqual(['Selection', 'Pane'])
    expect(index.linkType('Pane', context, other)[0].link?.href).toBe(bothGeneric
      ? '/selection.pick/#selection.pick.type-parameter.Pane' : '/pane.Pane/')
  })

  it('keeps TypeScript dollar identifiers intact when bound or unresolved', () => {
    const context = { ...symbol('selection.pick'), signatures: [{ params: [], typeParams: ['$Pane extends Model'] }] }
    const index = new SymbolIndex([context, symbol('selection.Selection'), symbol('pane.Pane')], (entry) => `/${entry.id}/`, 'ts')
    for (const expression of ['Selection<$Pane>', 'Selection<missing.$Pane>', 'Selection<Missing$Pane>']) {
      const parts = index.linkType(expression, context)
      expect(parts.map((part) => part.text).join('')).toBe(expression)
      expect(parts.filter((part) => part.link).map((part) => part.text)).toEqual(
        expression === 'Selection<$Pane>' ? ['Selection', '$Pane'] : ['Selection'])
    }
  })

  it('keeps authored links, literal fences and escaped backticks out of inference', () => {
    const text = '[`Selection<Pane>`](../guide/?label=(pane)#example) and `Pair<Pane>`; ``Selection<Pane>``; \\`Selection<Pane>\\`.'
    const spans = tokenizeDoc(text, 'ts')
    expect(spans.filter((span) => span.kind === 'link')).toEqual([
      { kind: 'link', text: 'Selection<Pane>', code: true, href: '../guide/?label=(pane)#example' },
    ])
    expect(spans.filter((span) => span.kind === 'ref')).toEqual([
      { kind: 'ref', target: 'Pair<Pane>', label: 'Pair<Pane>', role: 'any' },
    ])
    expect(spans.filter((span) => span.kind === 'code')).toEqual([{ kind: 'code', text: 'Selection<Pane>' }])
    expect(spans.at(-1)).toEqual({ kind: 'text', text: '; \\`Selection<Pane>\\`.' })
    expect(tokenizeDoc('[`Selection<Pane>`](javascript:bad)', 'ts')).toEqual([
      { kind: 'text', text: '[`Selection<Pane>`](javascript:bad)' },
    ])
  })

  it('retains native reST labels, TSDoc links and explicit literals', () => {
    expect(tokenizeDoc(':class:`selected panes <Selection>` and ``Selection<Pane>``', 'py')).toEqual([
      { kind: 'ref', role: 'class', target: 'Selection', label: 'selected panes' },
      { kind: 'text', text: ' and ' },
      { kind: 'code', text: 'Selection<Pane>' },
    ])
    expect(tokenizeDoc('{@link Selection selected panes} and {@code Selection<Pane>}', 'ts')).toEqual([
      { kind: 'ref', role: 'any', target: 'Selection', label: 'selected panes' },
      { kind: 'text', text: ' and ' },
      { kind: 'code', text: 'Selection<Pane>' },
    ])
    expect(tokenizeDoc('`{@link Pane}` and ``a `Pane` value``', 'ts')).toEqual([
      { kind: 'ref', role: 'any', target: '{@link Pane}', label: '{@link Pane}' },
      { kind: 'text', text: ' and ' },
      { kind: 'code', text: 'a `Pane` value' },
    ])
    expect(tokenizeDoc('[`Session`](@ref LibTmux.Session) and [`Server`](@ref)', 'julia')).toEqual([
      { kind: 'ref', role: 'any', target: 'LibTmux.Session', label: 'Session' },
      { kind: 'text', text: ' and ' },
      { kind: 'ref', role: 'any', target: 'Server', label: 'Server' },
    ])
  })

  it.each([
    ['java', '{@code `} and `Pane`'],
    ['ts', '{@code `} and `Pane`'],
    ['csharp', '<c>`</c> and `Pane`'],
    ['csharp', '<see cref="T:List`1"/> and `Pane`'],
  ])('does not pair a backtick inside native %s markup with following code', (port, text) => {
    expect(tokenizeDoc(text, port).at(-1)).toEqual({ kind: 'ref', role: 'any', target: 'Pane', label: 'Pane' })
  })

  it.each(['ts', 'julia', 'powershell'])('retains emphasized authored link destinations in %s', (port) => {
    expect(tokenizeDoc('[**Selection** and *Pane*](https://example.test)', port)).toEqual([
      { kind: 'link', text: 'Selection and Pane', href: 'https://example.test' },
    ])
  })
})
