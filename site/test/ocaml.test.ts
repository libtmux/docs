import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseFrontmatter } from '@astrojs/markdown-remark'
import { PORT_BY_SLUG, productAvailable } from '../src/lib/ports'
import { usesNativeSignatures, nativeSignatureText } from '../src/lib/api-sections'
import { API_MODELS } from '../src/lib/api-models'
import { navSidecar } from '../../packages/api-model/src/nav-sidecar'
import { SymbolIndex } from '@libtmux/api-model'
import { docsPath } from '../src/lib/docs-paths'

it('publishes authored overviews at their advertised section routes', () => {
  for (const [file, route] of [
    ['concepts/index.md', 'concepts'], ['examples/index.md', 'examples'],
    ['topics/index.md', 'topics'], ['workspace/reference.md', 'workspace/reference'],
  ]) {
    const source = readFileSync(new URL(`../src/content/docs/ports/ocaml/${file}`, import.meta.url), 'utf8')
    const { frontmatter } = parseFrontmatter(source, { frontmatter: 'remove' })
    const id = `ports/ocaml/${file}`.replace(/\.md$/, '').replace(/\/index$/, '')
    expect(docsPath({ id, data: frontmatter }), file).toBe(route)
  }
})

it('resolves authored odoc references from every exported public declaration', () => {
  const model = API_MODELS.ocaml!
  const index = new SymbolIndex(model.symbols, (symbol) => `/reference/${symbol.id}`, 'ocaml')
  const missing = model.symbols.flatMap((symbol) => [symbol.doc?.summary, symbol.doc?.body].filter(Boolean)
    .flatMap((text) => index.docSpans(text!, symbol).filter((span) => span.kind === 'ref' && !span.link)
      .map((span) => `${symbol.id}: ${span.kind === 'ref' ? span.target : ''}`)))
  expect(missing).toEqual([])
})

it('keeps OCaml native type syntax and excludes MCP while exposing workspaces', () => {
  const port = PORT_BY_SLUG.ocaml!
  expect(port.productAvailability?.mcp).toBe('excluded')
  expect(productAvailable(port, 'mcp')).toBe(false)
  expect(productAvailable(port, 'workspace')).toBe(true)
  const opaque = API_MODELS.ocaml!.symbols.find((symbol) => symbol.id === 'Libtmux.Pane.t')!
  expect(opaque.modifiers).toContain('opaque')
  expect(usesNativeSignatures(opaque, 'ocaml')).toBe(true)
  expect(nativeSignatureText(opaque, opaque.signatures[0]!, 'ocaml')).toBe('type t')
  expect(API_MODELS.ocaml!.symbols.some((symbol) => symbol.product === 'mcp')).toBe(false)
})

it('places live server connections under Server and captured tmux clients under Client', () => {
  const nav = navSidecar('ocaml', API_MODELS.ocaml!)!
  expect(nav.placement['Libtmux_unix.Client']).toBe('server')
  expect(nav.placement['Libtmux_eio.Client']).toBe('server')
  expect(nav.placement['Libtmux.Client_observation']).toBe('client')
})

it('attaches the tested bootstrap program to its workspace operations', () => {
  const model = API_MODELS.ocaml!
  const sourceUrl = `https://github.com/libtmux/libtmux-ocaml/blob/${model.revision}/examples/showcase_bootstrap.ml`
  const targets = ['Libtmux_unix.Workspace.submit_bootstrap',
    'Libtmux_unix.Workspace.await', 'Libtmux_unix.Workspace.client']
  for (const id of targets) {
    const symbol = model.symbols.find((entry) => entry.id === id)!
    const example = symbol.doc?.examples?.find((entry) => entry.lang === 'ocaml' && entry.sourceUrl === sourceUrl)
    expect(example, id).toBeDefined()
  }
})
