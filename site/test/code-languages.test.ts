import { createRenderer } from 'astro-expressive-code'
import { bundledLanguages } from 'shiki'
import { describe, expect, it } from 'vitest'
import config from '../ec.config.mjs'
import { codeLang, languageForFile } from '../src/lib/code-language'
import { fileGrammars } from '../src/lib/grammars/index.mjs'
import { highlightTokens } from '../src/lib/highlight'
import { PORTS } from '../src/lib/ports'
import { allCodeUses, fencesIn, isPlain, languagesIn, plainProblem, type CodeUse } from './code-languages'

/** Warnings Expressive Code logs while rendering a one-line block in each language. */
async function warningsFor(languages: string[]): Promise<Map<string, string>> {
  const warnings: string[] = []
  const renderer = await createRenderer({ ...config, logger: { warn: (message: string) => { warnings.push(message) } } })
  const failed = new Map<string, string>()
  for (const language of languages) {
    const before = warnings.length
    await renderer.ec.render({ code: 'x', language })
    if (warnings.length > before) failed.set(language, warnings[before])
  }
  return failed
}

const uses = allCodeUses()
const labels = [...new Set(uses.map((use) => use.lang))].filter((lang) => !isPlain(lang)).sort()
const where = (use: CodeUse) => `${use.from}${use.trail ? `#${use.trail}` : ''}`

describe('every code block the site renders has a grammar', () => {
  it('finds code in every source the pages draw from', () => {
    for (const source of ['src/content/', 'src/data/home-examples.json', 'src/data/landing-examples.json', 'src/data/core-capabilities.json',
      'src/data/api/', 'src/data/api-sources/', 'src/lib/ports.ts', 'src/components/']) {
      expect(uses.filter((use) => use.from.startsWith(source)).length, source).toBeGreaterThan(0)
    }
    expect(labels.length).toBeGreaterThan(30)
  })

  it('loads every label in Expressive Code without an "Error while highlighting" warning', async () => {
    const failed = await warningsFor(labels)
    expect([...failed.keys()]).toEqual([])
  })

  it('loads every label a component passes in the shared highlighter', async () => {
    const plain: string[] = []
    for (const lang of new Set(uses.filter((use) => !use.markdown && !isPlain(use.lang)).map((use) => use.lang))) {
      const found = await highlightTokens('x', lang)
      if (!found || found.language === 'text') plain.push(lang)
    }
    expect(plain).toEqual([])
  })

  it('leaves plain text to output, diagrams and instructions, never a file', () => {
    const problems = uses.flatMap((use) => {
      const problem = plainProblem(use)
      return problem ? [`${where(use)}: ${use.lang || 'untagged'} block ${problem}`] : []
    })
    expect(problems).toEqual([])
  })

  it('labels each named file with the language of its name', () => {
    const mismatches = uses.flatMap((use) => {
      const expected = use.file && /^[^\s()]+$/.test(use.file) && !use.file.endsWith('.md') ? languageForFile(use.file) : undefined
      return expected && !isPlain(use.lang) && codeLang(use.lang) !== codeLang(expected)
        ? [`${where(use)}: ${use.file} is ${use.lang}, its name says ${expected}`] : []
    })
    expect(mismatches).toEqual([])
  })

  it('gives every port a language for its signatures and source pages', async () => {
    for (const port of PORTS) expect(codeLang(port.slug), port.slug).not.toBe('text')
  })
})

/** Every file family the site's pages show or name, and the grammar that reads it. */
const FILES = [
  ['cabal.project', 'cabal', 'site'], ['libtmux-haskell.cabal', 'cabal', 'site'],
  ['go.mod', 'gomod', 'site'], ['Gemfile.lock', 'gemfile-lock', 'site'],
  ['dune', 'dune', 'site'], ['dune-project', 'dune', 'site'], ['libtmux.opam', 'opam', 'site'],
  ['rebar.config', 'erlang', 'Shiki'], ['mix.exs', 'elixir', 'Shiki'], ['Gemfile', 'ruby', 'Shiki'],
  ['justfile', 'just', 'Shiki'], ['META6.json', 'json', 'Shiki'], ['cpanfile', 'perl', 'Shiki'],
  ['libtmux.asd', 'lisp', 'Shiki'], ['deps.edn', 'clojure', 'Shiki'], ['Package.swift', 'swift', 'Shiki'],
  ['CMakeLists.txt', 'cmake', 'Shiki'], ['Example.csproj', 'xml', 'Shiki'], ['Example.fsproj', 'xml', 'Shiki'],
  ['pom.xml', 'xml', 'Shiki'], ['build.gradle', 'groovy', 'Shiki'], ['build.gradle.kts', 'kotlin', 'Shiki'],
  ['settings.gradle.kts', 'kotlin', 'Shiki'], ['build.sbt', 'scala', 'Shiki'], ['Cargo.toml', 'toml', 'Shiki'],
  ['Cargo.lock', 'toml', 'Shiki'], ['Project.toml', 'toml', 'Shiki'], ['libtmux-0.1-1.rockspec', 'lua', 'Shiki'],
  ['gradle.properties', 'properties', 'Shiki'], ['src/tmux_example.app.src', 'erlang', 'Shiki'],
] as const

describe('file names', () => {
  it.each(FILES)('%s is read as %s', async (file, language, grammar) => {
    expect(languageForFile(file)).toBe(language)
    const found = await highlightTokens('x', language)
    expect(found?.language).not.toBe('text')
    if (grammar === 'site') expect(fileGrammars.some((entry) => entry.name === language)).toBe(true)
    else expect(codeLang(language) in bundledLanguages || ['properties'].includes(language)).toBe(true)
  })

  it('says nothing for a name that does not carry a language', () => {
    for (const file of ['Terminal', 'notes.unknown', 'README']) expect(languageForFile(file), file).toBeUndefined()
  })
})

describe('the audit catches what it is for', () => {
  const block = (use: Partial<CodeUse>): CodeUse => ({ from: 'page.md', lang: 'text', ...use })

  it('flags a plain block that names or holds a file', () => {
    expect(plainProblem(block({ file: 'cabal.project' }))).toContain('cabal.project')
    expect(plainProblem(block({ lang: '', file: 'workspace.conf' }))).toContain('workspace.conf')
    expect(plainProblem(block({ head: 'module example.com/x\n\ngo 1.26.0' }))).toContain('go.mod')
    expect(plainProblem(block({ head: 'cabal-version: 3.18\nname: x' }))).toContain('cabal')
  })

  it('lets output, diagrams and install instructions stay plain', () => {
    expect(plainProblem(block({ head: 'work-one, work-two' }))).toBeUndefined()
    expect(plainProblem(block({ lang: '', head: 'Server\n├── Session' }))).toBeUndefined()
    expect(plainProblem(block({ trail: 'cxx.initProject', file: 'CMakeLists.txt' }))).toBeUndefined()
    expect(plainProblem(block({ lang: 'cabal', file: 'cabal.project' }))).toBeUndefined()
  })

  it('reads fences and data entries the same way', () => {
    expect(fencesIn('```text title="go.mod"\nmodule x\n```\n\n````md\n```cabal\n```\n````\n', 'a.md'))
      .toEqual([
        { from: 'a.md', trail: undefined, lang: 'text', file: 'go.mod', head: 'module x', markdown: true },
        { from: 'a.md', trail: undefined, lang: 'md', file: undefined, head: '```cabal\n```', markdown: true },
      ])
    expect(languagesIn({ a: [{ lang: 'cabal', name: 'cabal.project', code: 'packages: .' }], b: { body: 'x\n```gomod\nmodule x\n```' } }, 'd.json'))
      .toEqual([
        { from: 'd.json', trail: 'a[0]', lang: 'cabal', file: 'cabal.project', head: 'packages: .' },
        { from: 'd.json', trail: 'b.body', lang: 'gomod', file: undefined, head: 'module x', markdown: false },
      ])
  })

  it('warns for a label no highlighter has, as it did for cabal', async () => {
    const failed = await warningsFor(['gomod', 'unregistered-format'])
    expect([...failed.keys()]).toEqual(['unregistered-format'])
    expect(failed.get('unregistered-format')).toContain('Error while highlighting code block using language "unregistered-format"')
  })

  it('reports a label the shared highlighter drops to plain text', async () => {
    expect((await highlightTokens('x', 'unregistered-format'))?.language).toBe('text')
  })
})
