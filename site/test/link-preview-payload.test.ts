import { describe, expect, it } from 'vitest'
import { docSummaryText } from '@libtmux/api-model'
import { API_GLOSSARY_PATH } from '../src/lib/api-glossary'
import { API_MODELS } from '../src/lib/api-models'
import { nativeQualifiedName } from '../src/lib/native-name'
import { PORT_BY_SLUG } from '../src/lib/ports'
import { kindMark } from '../src/lib/api-labels'
import { glossaryPreview, symbolPreview, tmuxManualPreview } from '../src/lib/link-preview'
import { mcpObjects } from '../src/lib/mcp-catalog'
import { mcpObjectPreview } from '../src/lib/mcp-preview'
import { tmuxCatalogEntries } from '../src/lib/tmux-catalog'
import { tmuxCatalogPreview } from '../src/lib/tmux-catalog-preview'

/** What the producers write for a card: its footer, and the names its summary mentions. Both are optional additions to schema 1. */
describe('the payloads that feed the card', () => {
  it('keeps schema 1 and the original fields, and adds only optional ones', () => {
    const model = API_MODELS.rs
    for (const symbol of model.symbols.slice(0, 300)) {
      const preview = symbolPreview(model, symbol, 'latest')
      expect(preview.schema).toBe(1)
      const summary = symbol.doc?.summary ?? symbol.signatures.find((signature) => signature.doc?.summary)?.doc?.summary
      expect(preview.description).toBe(summary ? docSummaryText(summary, model.port) : '')
      expect(Object.keys(JSON.parse(JSON.stringify(preview))).every((key) => ['schema', 'title', 'kind', 'description', 'descriptionParts', 'detail', 'signature', 'signatureLanguage',
        'href', 'footer', 'source'].includes(key)), symbol.id).toBe(true)
    }
  })

  it('names the package and the owner of a member in its footer, and the package alone for a type', () => {
    const model = API_MODELS.rs
    const member = model.symbols.find((symbol) => symbol.parent && model.symbols.some((owner) => owner.id === symbol.parent))!
    const owner = model.symbols.find((symbol) => symbol.id === member.parent)!
    expect(symbolPreview(model, member, 'latest').footer).toEqual([member.package ?? 'libtmux', owner.name])
    const type = model.symbols.find((symbol) => !symbol.parent)!
    expect(symbolPreview(model, type, 'latest').footer).toEqual([type.package ?? 'libtmux'])
  })

  it('names the declaring crate of a Rust symbol and the package of any other, never the same place twice', { timeout: 30_000 }, () => {
    const rs = API_MODELS.rs
    const footerOf = (id: string) => symbolPreview(rs, rs.symbols.find((symbol) => (symbol.publicId ?? symbol.id) === id)!, 'latest').footer
    expect(footerOf('server.Server.new_session')).toEqual(['libtmux', 'Server'])
    expect(footerOf('config.ConfigError')).toEqual(['tmux_workspace'])
    expect(footerOf('mcp.src.TmuxTools.new')).toEqual(['tmux_mcp', 'TmuxTools'])
    // The crate in the footer is the crate that the page's Qualified name row begins with.
    for (const symbol of rs.symbols) expect(nativeQualifiedName(rs, symbol).startsWith(`${symbolPreview(rs, symbol, 'latest').footer![0]}::`), symbol.id).toBe(true)
    for (const [port, model] of Object.entries(API_MODELS)) {
      if (port === 'rs') continue
      const portPackage = PORT_BY_SLUG[port].packageName
      for (const symbol of model.symbols) expect(symbolPreview(model, symbol, 'latest').footer![0], `${port} ${symbol.id}`).toBe(symbol.package ?? portPackage)
    }
    // PowerShell's module is its package: the footer says so once.
    const powershell = API_MODELS.powershell
    const command = powershell.symbols.find((symbol) => symbol.parent && symbol.package === 'LibTmux')!
    expect(symbolPreview(powershell, command, 'latest').footer).toEqual(['LibTmux'])
    const workspace = powershell.symbols.find((symbol) => symbol.parent && symbol.package === 'LibTmux.Workspace')!
    expect(symbolPreview(powershell, workspace, 'latest').footer).toEqual(['LibTmux.Workspace'])
  })

  it('never repeats a place in a footer', { timeout: 30_000 }, () => {
    for (const [port, model] of Object.entries(API_MODELS)) {
      for (const symbol of model.symbols) {
        const footer = symbolPreview(model, symbol, 'latest').footer ?? []
        expect(footer.every((place, index) => place !== footer[index - 1]), `${port} ${symbol.id}: ${footer.join(' · ')}`).toBe(true)
      }
    }
  })

  it('reads each summary as its text and the names that resolve to a page, in every port', { timeout: 30_000 }, () => {
    let marked = 0
    for (const [port, model] of Object.entries(API_MODELS)) {
      for (const symbol of model.symbols) {
        const preview = symbolPreview(model, symbol, 'latest')
        if (!preview.descriptionParts) continue
        marked++
        expect(preview.descriptionParts.map((part) => typeof part === 'string' ? part : part.text).join(''), `${port} ${symbol.id}`).toBe(preview.description)
        for (const part of preview.descriptionParts) {
          if (typeof part === 'string') continue
          expect(part.href, `${port} ${symbol.id}`).toMatch(/^\/(?!\/)/)
          expect(kindMark(part.kind === 'cmdlet' ? 'function' : part.kind!), `${port} ${symbol.id}: ${part.text}`).toBeDefined()
          expect(part.text, `${port} ${symbol.id}`).not.toBe('')
        }
        // The card does not link a declaration to itself.
        expect(preview.descriptionParts.some((part) => typeof part !== 'string' && part.href === preview.href), `${port} ${symbol.id}`).toBe(false)
      }
    }
    expect(marked).toBeGreaterThan(0)
  })

  it('footers the rest of the kinds with where they live', () => {
    const glossary = glossaryPreview(API_GLOSSARY_PATH)
    expect(glossary.footer).toBeUndefined()
    expect(glossary.terms!.struct.footer).toEqual(['API glossary', 'Symbol kinds'])
    expect(glossary.terms!.inherited.footer).toEqual(['API glossary', 'Modifiers'])
    const manual = tmuxManualPreview('latest', 'full')
    expect(Object.values(manual.terms!).every((term) => term.footer?.[1] === 'Manual' && /^tmux \d/.test(term.footer[0]))).toBe(true)
    expect(tmuxManualPreview('latest', 'new-session').footer).toEqual(manual.terms![Object.keys(manual.terms!)[0]].footer)
    const hook = tmuxCatalogEntries('latest', 'hook')[0]
    expect(tmuxCatalogPreview('latest', hook).footer).toEqual([manual.terms![Object.keys(manual.terms!)[0]].footer![0], 'Hooks'])
  })

  it('links the names that an MCP description gives its sibling objects, as its page does, and never the object itself', { timeout: 30_000 }, () => {
    let linked = 0
    for (const port of ['ruby', 'py', 'ts', 'rs', 'go', 'java', 'julia']) {
      for (const object of mcpObjects(port)) {
        const preview = mcpObjectPreview(port, 'latest', object)
        expect(preview.footer?.[0]).toBeTruthy()
        expect(preview.footer?.[1]).toMatch(/^MCP (tools|prompts|resources)$/)
        if (!preview.descriptionParts) continue
        linked++
        expect(preview.descriptionParts.map((part) => typeof part === 'string' ? part : part.text).join('')).toBe(preview.description)
        for (const part of preview.descriptionParts) {
          if (typeof part === 'string') continue
          expect(part.href).not.toBe(preview.href)
          expect(['tool', 'prompt', 'resource', 'resource-template']).toContain(part.kind)
        }
      }
    }
    expect(linked).toBeGreaterThan(0)
  })
})
