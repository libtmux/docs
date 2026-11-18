import { readFileSync } from 'node:fs'
import { createRenderer } from 'astro-expressive-code'
import { select } from 'astro-expressive-code/hast'
import { beforeAll, describe, expect, it } from 'vitest'
import ecConfig from '../ec.config.mjs'
import go from '../src/data/api/go.json'
import { exampleFrame } from '../src/lib/example-frame'

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')

/** What the frame of an API page's example says about its code: a file name and "Complete program" for a whole file, nothing for a fragment. */
describe('the frame of an API example', () => {
  const url = (name: string) => `https://github.com/libtmux/example/blob/0123456/${name}`

  it('names the file the reader saves and calls a whole runnable file a complete program', () => {
    expect(exampleFrame({ lang: 'go', intro: 'Save this complete example as `example_test.go`. It creates a socket.', sourceUrl: url('tmux/api_server_sessions_example_test.go') }))
      .toEqual({ title: 'example_test.go', program: true })
    expect(exampleFrame({ lang: 'rust', intro: 'Replace `src/main.rs` with this complete program.', sourceUrl: url('api_input.rs') }))
      .toEqual({ title: 'src/main.rs', program: true })
    expect(exampleFrame({ lang: 'swift', intro: 'Create a `Sources` directory and save this complete program as `Sources/Example.swift`.', sourceUrl: url('ApiSplitPane.swift') }))
      .toEqual({ title: 'Sources/Example.swift', program: true })
    expect(exampleFrame({ lang: 'sh', intro: 'Save this launcher as `run.sh`.', sourceUrl: url('run.sh') })).toEqual({ title: 'run.sh', program: true })
  })

  it('names the source file when the intro names none', () => {
    expect(exampleFrame({ lang: 'ocaml', intro: 'This complete program creates a private daemon.', sourceUrl: url('showcase_graph.ml') })).toEqual({ title: 'showcase_graph.ml', program: true })
  })

  it('names a build or manifest file but does not call it a program', () => {
    expect(exampleFrame({ lang: 'xml', intro: 'Save this project as `Example.csproj`.', sourceUrl: url('Example.csproj') })).toEqual({ title: 'Example.csproj', program: false })
    expect(exampleFrame({ lang: 'properties', intro: 'Save this consumer setup as `gradle.properties`:', sourceUrl: url('gradle.properties') })).toEqual({ title: 'gradle.properties', program: false })
    expect(exampleFrame({ lang: 'clojure', intro: 'Save this as `deps.edn`.', sourceUrl: url('deps.edn') })).toEqual({ title: 'deps.edn', program: false })
    expect(exampleFrame({ lang: 'cmake', sourceUrl: url('CMakeLists.txt') })).toEqual({ title: 'CMakeLists.txt', program: false })
  })

  it('gives a fragment no file name and no role, whatever its intro says', () => {
    expect(exampleFrame({ lang: 'rust', intro: 'Outside an async context it runs the future:' })).toEqual({ program: false })
    expect(exampleFrame({ lang: 'go' })).toEqual({ program: false })
    // A help page is not a file: PowerShell's one-line examples point at the cmdlet's help.
    expect(exampleFrame({ lang: 'powershell', intro: 'Example 1  Connect to the server.', sourceUrl: url('Connect-TmuxControl.md') })).toEqual({ program: false })
  })

  it('titles every complete Go example with the file its intro tells the reader to save', () => {
    const examples = go.symbols.flatMap((symbol) => ('doc' in symbol && symbol.doc && 'examples' in symbol.doc ? symbol.doc.examples ?? [] : []) as { lang: string; code: string; intro?: string; sourceUrl?: string }[])
    const complete = examples.filter((example) => example.sourceUrl)
    expect(complete.length).toBeGreaterThan(0)
    for (const example of complete) expect(exampleFrame(example)).toEqual({ title: 'example_test.go', program: true })
    for (const example of examples.filter((candidate) => !candidate.sourceUrl)) expect(exampleFrame(example)).toEqual({ program: false })
  })

  it('draws it from the page: each example takes its frame from the helper, and none is given an empty title', () => {
    const entry = source('components/api/ApiEntry.astro')
    expect(entry).toContain('exampleFrame(ex)')
    expect(entry).not.toMatch(/<Code[^>]*title=""/)
  })
})

describe('a frame with no file name', () => {
  let render: (code: string, language: string, meta: string) => Promise<unknown>
  beforeAll(async () => {
    const renderer = await createRenderer(ecConfig)
    render = async (code, language, meta) => (await renderer.ec.render({ code, language, meta })).renderedGroupAst
  })

  it('draws no empty header, and a frame with one still draws it', async () => {
    expect(select('figcaption.header', await render('package main', 'go', '') as never), 'a fragment').toBeUndefined()
    expect(select('figcaption.header', await render('package main', 'go', 'title=""') as never), 'an empty title').toBeUndefined()
    expect(select('figcaption.header', await render('package main', 'go', 'frame="none"') as never)).toBeUndefined()
    const titled = select('figcaption.header', await render('package main', 'go', 'title="example_test.go" frame="code" role="program"') as never)!
    expect(select('.title', titled)).toBeDefined()
    expect(select('.role', titled)).toBeDefined()
  })

  it('keeps the title bar of a terminal, which carries its own label', async () => {
    expect(select('figcaption.header', await render('$ go test', 'console', '') as never)).toBeDefined()
  })
})
