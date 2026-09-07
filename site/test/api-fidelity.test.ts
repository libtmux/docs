import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiModel, ApiSymbol } from '@libtmux/api-model'
import { sourceUrl } from '@libtmux/api-model'
import { PORTS } from '../src/lib/ports'

const root = fileURLToPath(new URL('../../', import.meta.url))
const models = Object.fromEntries(PORTS.map((port) => [port.slug,
  JSON.parse(readFileSync(join(root, `site/src/data/api/${port.slug}.json`), 'utf8')) as ApiModel,
]))
const scratch: string[] = []
afterEach(() => scratch.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })))

const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

function entry(model: ApiModel, symbol: ApiSymbol, linked = true): string {
  const id = escape(symbol.publicId ?? symbol.id)
  const source = linked ? sourceUrl(model, symbol) : undefined
  const links = `<a class="headerlink" href="#${id}">¶</a>${source ? `<a href="${escape(source)}">source</a>` : ''}`
  return `<dl><dt class="gp-sphinx-api-header" id="${id}" data-domain="std" data-objtype="${symbol.kind}" data-badge-count="0" data-has-badges="false" data-has-source="${Boolean(source)}" data-signature-expanded="true"><span class="gp-sphinx-api-layout--desktop">${links}</span><span class="gp-sphinx-api-layout--mobile">${links}</span></dt><dd>Reference fixture</dd></dl>`
}

function page(path: string, port: string, entries: string[]): void {
  const directory = join(path, 'reference', port, 'sample')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'index.html'), entries.join('\n'))
}

function fixture(): string {
  const path = mkdtempSync(join(tmpdir(), 'libtmux-api-fidelity-'))
  scratch.push(path)
  for (const [port, model] of Object.entries(models)) {
    const symbol = model.symbols.find((candidate) => sourceUrl(model, candidate))!
    page(path, port, [entry(model, symbol)])
  }
  return path
}

const audit = (path: string) => spawnSync(process.execPath, ['scripts/check-api-fidelity.mjs', path], { cwd: root, encoding: 'utf8' })

describe('API source fidelity gate', () => {
  it('exempts a graph-proven inherited Swift entry without inventing a link', () => {
    const path = fixture()
    const model = models.swift
    const declared = model.symbols.find((symbol) => sourceUrl(model, symbol))!
    const inherited = model.symbols.find((symbol) => symbol.inheritedFrom && !symbol.source.file)!
    expect(inherited).toBeDefined()
    page(path, 'swift', [entry(model, declared), entry(model, inherited, false)])
    const result = audit(path)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toMatch(/swift\s+1\s+2\s+1\s+1\s+100%/)
  })

  it('keeps an unexplained missing source in the coverage denominator', () => {
    const path = fixture()
    const model = models.swift
    const declared = model.symbols.find((symbol) => sourceUrl(model, symbol))!
    const unexplained = { ...declared, id: 'UnexplainedDeclaration', publicId: 'UnexplainedDeclaration' }
    page(path, 'swift', [entry(model, declared), entry(model, unexplained, false)])
    const result = audit(path)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('swift: only 50% of source-eligible entries link to source (1/2)')
  })

  it('fails a missing known source even when aggregate coverage exceeds the floor', () => {
    const path = fixture()
    const model = models.py
    const declarations = model.symbols.filter((symbol) => sourceUrl(model, symbol)).slice(0, 20)
    expect(declarations).toHaveLength(20)
    page(path, 'py', declarations.map((symbol, index) => entry(model, symbol, index !== 0)))
    const result = audit(path)
    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/py\s+1\s+20\s+20\s+19\s+95%/)
    expect(result.stderr).toContain(`#${declarations[0].publicId ?? declarations[0].id} omits its known source link`)
    expect(result.stderr).not.toContain('source-eligible entries link to source')
  })
})
