import { createRenderer } from 'astro-expressive-code'
import { toHtml } from 'astro-expressive-code/hast'
import { describe, expect, it } from 'vitest'
import config from '../ec.config.mjs'
import examples from '../src/data/home-examples.json'
import { codeLang } from '../src/lib/code-language'
import { fileGrammars } from '../src/lib/grammars/index.mjs'
import { highlightInline } from '../src/lib/highlight'

/** The site's own grammars, each with a real file from the pages that show it. */
const home = examples as unknown as Record<string, { files: { name: string; code: string }[] }>
const fileOf = (port: string, name: string) => home[port].files.find((file) => file.name === name)!.code

// A real opam file from the OCaml port, which the site names but does not show.
const OPAM = `opam-version: "2.0"
synopsis: "Native OCaml values and queries for tmux"
description: """
Immutable tmux graph observations and typed filter expressions.
"""
license: "MIT"
homepage: "https://libtmux.org/en/ocaml/"
depends: [
  "ocaml" {= "5.5.2"}
  "alcotest" {with-test & = "1.9.1"}
  "odoc" {with-doc & = "3.2.2"}
]
build: [
  ["dune" "build" "-p" name "-j" jobs "@install" "@runtest" {with-test} "@doc" {with-doc}]
]
`

interface Fixture {
  language: string
  code: string
  /** One token from each kind of thing the grammar names; they must not all share a colour. */
  tokens: string[]
  /** How many colours the tokens span in one theme. */
  kinds?: number
}

const FIXTURES: Fixture[] = [
  { language: 'cabal', code: fileOf('haskell', 'libtmux-mutate-graph.cabal'), tokens: ['build-depends', 'libtmux-haskell', '^>=', '0.0.1.0', '&&', '-Wall'] },
  { language: 'cabal', code: fileOf('haskell', 'cabal.project'), tokens: ['source-repository-package', 'location', 'https://github.com/libtmux/libtmux-haskell', '2026-11-06T00:00:00Z'] },
  { language: 'gomod', code: fileOf('go', 'go.mod'), tokens: ['module', 'go', 'require', 'v0.1.2', 'github.com/libtmux/libtmux-go'] },
  { language: 'gemfile-lock', code: fileOf('ruby', 'Gemfile.lock'), tokens: ['GEM', 'remote', 'libtmux', '~>', '0.1.2', 'sha256', 'ruby'] },
  { language: 'dune', code: fileOf('ocaml', 'dune-project'), tokens: ['lang', '3.24'], kinds: 2 },
  { language: 'dune', code: fileOf('ocaml', 'examples/dune'), tokens: ['executable', 'name', 'libraries'], kinds: 1 },
  { language: 'opam', code: OPAM, tokens: ['opam-version', '"2.0"', 'with-test', '&', '='] },
]

type Paint = Map<string, { dark: string; light: string }>

const decode = (text: string) => text.replace(/&#x([0-9A-F]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))

/** The two theme colours of every token Expressive Code draws, by token text. */
async function paint(code: string, language: string): Promise<Paint> {
  const renderer = await createRenderer(config)
  const html = toHtml((await renderer.ec.render({ code, language })).renderedGroupAst)
  const painted: Paint = new Map()
  for (const [, dark, light, text] of html.matchAll(/<span style="--0:([^;"]+)(?:;--0[a-z]+:[^;"]+)*;--1:([^;"]+)[^"]*">([^<]*)<\/span>/g)) {
    for (const piece of decode(text).split(/\s+/).filter(Boolean)) painted.set(piece, { dark: dark.toLowerCase(), light: light.toLowerCase() })
  }
  return painted
}

/** The theme colour plain text takes, which a highlighted token must leave. */
const FOREGROUND = { dark: '#e1e4e8', light: '#24292e' }

/**
 * Whether the named tokens are drawn in more than one colour per theme, all
 * of them in a colour other than the plain foreground, and each in a
 * different colour in the dark theme than in the light one.
 */
function highlighted(painted: Paint, tokens: string[], kinds = 3): boolean {
  const found = tokens.map((token) => painted.get(token))
  if (found.some((entry) => !entry)) return false
  const colours = found as { dark: string; light: string }[]
  return colours.every(({ dark, light }) => dark !== FOREGROUND.dark && light !== FOREGROUND.light && dark !== light)
    && new Set(colours.map(({ dark }) => dark)).size >= kinds && new Set(colours.map(({ light }) => light)).size >= kinds
}

describe('the site grammars', () => {
  it('registers every grammar under names codeLang accepts', () => {
    for (const grammar of fileGrammars) {
      for (const name of [grammar.name, ...(grammar.aliases ?? [])]) expect(codeLang(name), name).not.toBe('text')
    }
  })

  it.each(FIXTURES.map((fixture, index) => [`${fixture.language} #${index + 1}`, fixture] as const))(
    'colours %s in Expressive Code and in the shared highlighter, in both themes',
    async (_label, { language, code, tokens, kinds }) => {
      const painted = await paint(code, language)
      expect(highlighted(painted, tokens, kinds), `${tokens.join(' ')} in ${[...painted.keys()].join(' ')}`).toBe(true)
      // The same text as plain text fails the predicate that the grammar passes.
      expect(highlighted(await paint(code, 'text'), tokens, kinds)).toBe(false)

      const inline = await highlightInline(code, language)
      const text = decode(inline.replace(/<[^>]+>/g, ''))
      expect(text.replace(/\n$/, '')).toBe(code.replace(/\n$/, ''))
      const colours = (html: string) => new Set([...html.matchAll(/--shiki-light:([^;"]+);--shiki-dark:([^;"]+)/g)].map((match) => match[1] + match[2])).size
      expect(colours(inline), 'colours in the shared highlighter').toBeGreaterThan(Math.max(1, colours(await highlightInline(code, 'text'))))
    },
  )

  it.each([
    ['cabal.project', 'cabal'], ['go.mod', 'gomod'], ['go-mod', 'gomod'], ['Gemfile.lock', 'gemfile-lock'], ['dune-project', 'dune'],
  ])('reads a fence labelled with the file name %s as %s', async (label, language) => {
    const code = FIXTURES.find((fixture) => fixture.language === language)!.code
    const renderer = await createRenderer(config)
    const named = toHtml((await renderer.ec.render({ code, language: label.toLowerCase() })).renderedGroupAst)
    const direct = toHtml((await renderer.ec.render({ code, language })).renderedGroupAst)
    expect(named.replace(/data-language="[^"]*"/, '')).toBe(direct.replace(/data-language="[^"]*"/, ''))
  })
})
