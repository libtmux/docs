import { describe, expect, it } from 'vitest'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { SymbolIndex, typeParameterId, type ApiSymbol, type Signature } from '@libtmux/api-model'
import { API_MODELS } from '../src/lib/api-models'
import { apiEntryFields, apiEntrySections, nativeSignatureText } from '../src/lib/api-sections'
import { apiSignatureLayouts, signatureSpans } from '../src/lib/code-layout'
import { symbolMarkdown, symbolMarkdownWithLayout } from '../src/lib/symbol-markdown'

const model = API_MODELS.ts
const hrefFor = (entry: ApiSymbol) => `/en/ts/latest/reference/${entry.slug}/`
const index = new SymbolIndex(model.symbols, hrefFor, 'ts')
const find = (id: string): ApiSymbol => model.symbols.find((entry) => entry.id === id)!
const selection = find('selection.Selection')
const where = find('selection.Selection.where')
const modelAnchor = `${hrefFor(selection)}#${typeParameterId(selection, 'Model')}`

describe('TypeScript Selection.where', () => {
  it('declares Model once, on the interface page', () => {
    expect(apiEntryFields(selection, 'ts').typeParameters).toMatchObject([{ name: 'Model', overloads: [] }])
    expect(apiEntrySections(selection, 'ts', index).map((section) => section.label)).toContain('Type parameters')
    expect(apiEntrySections(selection, 'ts', index).find((section) => section.label === 'Type parameters')?.id)
      .toBe('selection.Selection.type-parameters')
  })

  it('shows the owner parameter on the member page without declaring it again', () => {
    expect(apiEntryFields(where, 'ts').typeParameters).toEqual([])
    expect(apiEntrySections(where, 'ts').map((section) => section.label)).not.toContain('Type parameters')
    expect(apiEntrySections(where, 'ts', index).map((section) => section.label)).toContain('Type parameters')
    expect(index.inheritedTypeParameters(where).map((entry) => [entry.owner.id, entry.parameter.name, entry.href]))
      .toEqual([['selection.Selection', 'Model', modelAnchor.replace(/#.*/, `#${encodeURIComponent(typeParameterId(selection, 'Model'))}`)]])
  })

  it('links every Model in the formatted native signature to the interface anchor', async () => {
    const layout = (await apiSignatureLayouts(where, 'ts')).get(where.signatures[0])!
    expect(layout.text).toContain('Selection<Model>')
    const spans = signatureSpans(layout, index, where, where.signatures[0])
    const models = spans.filter((span) => span.text === 'Model')
    expect(models).toHaveLength(2)
    expect(models.map((span) => span.link?.href)).toEqual([modelAnchor, modelAnchor])
    expect(spans.map((span) => span.text).join('')).toBe(layout.text)
  })

  it('links the unformatted signature text the same way', () => {
    const signature = where.signatures[0]
    const text = nativeSignatureText(where, { ...signature, raw: 'where(criteria: WhereOf<Model>): Selection<Model>' }, 'ts')
    const spans = index.linkType(text, where, signature)
    expect(spans.filter((span) => span.text === 'Model').map((span) => span.link?.href)).toEqual([modelAnchor, modelAnchor])
  })

  it('exports the same links in Markdown prose and a Type parameters section', async () => {
    const symbol: ApiSymbol = { ...where, doc: { summary: 'Keep the `Model` members that match.' } }
    const markdown = symbolMarkdown({ model, symbol, index })
    expect(markdown).toContain(`Keep the [\`Model\`](${modelAnchor}) members that match.`)
    const section = markdown.split('## Type parameters\n\n')[1]!.split('\n\n')[0]!
    expect(section).toBe(`- [\`Model\`](${modelAnchor}), declared by [\`Selection<Model>\`](${hrefFor(selection)})`)
    expect(fromMarkdown(markdown).children.some((node) => node.type === 'heading' && node.depth === 2
      && node.children[0]?.type === 'text' && node.children[0].value === 'Type parameters')).toBe(true)
    // The layout-aware export prints the same section.
    expect(await symbolMarkdownWithLayout({ model, symbol, index })).toContain(section)
  })

  it('lists the interface parameter with its own anchor in Markdown', () => {
    const markdown = symbolMarkdown({ model, symbol: selection, index })
    expect(markdown).toContain('## Type parameters\n\n- `Model`')
    expect(markdown).not.toContain('declared by')
  })
})

describe('type parameter sections', () => {
  const generic: Signature = { params: [], typeParams: ['T extends Base = Default'], typeParameters: [{ name: 'T', bound: 'Base', default: 'Default', doc: 'What it holds.' }] }
  const other: Signature = { params: [{ name: 'value', type: 'string' }], typeParameters: [{ name: 'T', bound: 'Other' }] }
  const callable: ApiSymbol = { id: 'm.pick', name: 'pick', kind: 'function', modifiers: ['overload'], signatures: [generic, other], source: { file: 'm.ts' } }

  it('keeps one entry per distinct declaration and labels the overload that declares it', () => {
    const { typeParameters } = apiEntryFields(callable, 'ts')
    expect(typeParameters).toMatchObject([
      { name: 'T', bound: 'Base', default: 'Default', doc: 'What it holds.', overloads: [expect.any(String)] },
      { name: 'T', bound: 'Other', overloads: [expect.any(String)] },
    ])
    expect(apiEntrySections(callable, 'ts').map((section) => section.id)).toEqual(['m.pick.type-parameters', 'm.pick.parameters'])
  })

  it('does not repeat a record parameter that its constructor signature carries too', () => {
    const record: ApiSymbol = {
      id: 'm.Result', name: 'Result', kind: 'class', modifiers: [], source: { file: 'm.cs' },
      typeParameters: [{ name: 'T', bound: 'class' }],
      signatures: [{ params: [{ name: 'Value', type: 'T?' }], typeParameters: [{ name: 'T', bound: 'class' }] }],
    }
    expect(apiEntryFields(record, 'csharp').typeParameters).toHaveLength(1)
  })

  it('exposes nothing for a Julia alias, whose recorded parameters are applied arguments', () => {
    const alias: ApiSymbol = { id: 'J.PaneRef', name: 'PaneRef', kind: 'typealias', modifiers: [], signatures: [], source: { file: 'm.jl' }, typeParams: ['PaneID'] }
    expect(apiEntryFields(alias, 'julia').typeParameters).toEqual([])
  })
})
