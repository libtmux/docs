import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { danglingReport } from '../src/integrations/dangling-report'
import { danglingReportPath } from '../src/lib/dangling-report-path'
import { rehypeApiLinks } from '../src/plugins/rehype-api-links'

/**
 * The build's ceiling counts every line of one file, and any process that renders prose through the linker can write to
 * it. A test run beside a build once added hundreds of names the build never met and failed the build's gate. These hold
 * the build's file to the build: a test renders the site's prose, in a port's build, and the file does not move.
 */
const build = fileURLToPath(new URL('../.astro/dangling-refs.json', import.meta.url))
const processor = createMarkdownProcessor({ rehypePlugins: [rehypeApiLinks], syntaxHighlight: false })

/** What a shared guide says to the linker in a port's build: a file, a key sent by a link, a target, a name nothing defines. */
const guide = [
  'Write the options to `tmux.conf`, then send ([`Enter`](/tmux/latest/manual/send-keys/), `C-c`) to the pane.',
  '',
  'Capture `capture:0.0` or `=work:editor`, and call `Nope.thing()`.',
].join('\n')
const render = async (port = 'py') => {
  vi.stubEnv('LIBTMUX_DOCS_PORT', port)
  await (await processor).render(guide, { frontmatter: {} })
}

/** The state of a report file, to compare before and after: whether it exists and how much it holds. */
const state = (file: string) => existsSync(file) ? { size: statSync(file).size, mtime: statSync(file).mtimeMs } : undefined
const names = (file: string) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line).text as string)

let directory: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'dangling-')) })
afterEach(() => { vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }) })

describe('the build\'s dangling report', () => {
  it('is not written by a test that renders the site\'s prose in a port\'s build', async () => {
    const before = state(build)
    for (const port of ['py', 'ts', 'swift']) await render(port)
    expect(state(build)).toEqual(before)
    expect(danglingReportPath()).toBeUndefined()
  })

  it('is the build\'s own file outside a test, unless a file is named', () => {
    expect(danglingReportPath({})).toBe(build)
    expect(danglingReportPath({ LIBTMUX_DOCS_PORT: 'py' })).toBe(build)
    expect(danglingReportPath({ VITEST: 'true' })).toBeUndefined()
    expect(danglingReportPath({ VITEST: 'true', LIBTMUX_DOCS_DANGLING_REPORT: '/tmp/own.jsonl' })).toBe('/tmp/own.jsonl')
    expect(danglingReportPath({ LIBTMUX_DOCS_DANGLING_REPORT: '/tmp/own.jsonl' })).toBe('/tmp/own.jsonl')
  })

  it('still records what nothing defines, in the file a test names', async () => {
    const own = join(directory, 'own.jsonl')
    vi.stubEnv('LIBTMUX_DOCS_DANGLING_REPORT', own)
    const before = state(build)
    await render()
    // A key sent by a link is not a reference to resolve, nor is a session target; the rest is read in the port's build.
    expect(names(own).sort()).toEqual(['Nope.thing()', 'capture:0.0', 'tmux.conf'])
    expect(state(build)).toEqual(before)
  })

  it('resolves Clojure dependencies and leaves fixture settings literal without concealing a missing var', async () => {
    const own = join(directory, 'clojure.jsonl')
    vi.stubEnv('LIBTMUX_DOCS_DANGLING_REPORT', own)
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'clojure')
    const text = 'The fixture supplies `libtmux.docs.socket` and `libtmux.docs.binary`. Failures throw `ExceptionInfo`. Add `io.github.libtmux/libtmux-clojure-core-async` for `core.async`; use `libtmux.core/snapshot!`.'
    const rendered = await (await processor).render(text, { frontmatter: { port: 'clojure' } })
    expect(names(own)).toEqual([])
    expect(rendered.code).toContain('https://github.com/clojure/clojure/blob/clojure-1.12.6/src/jvm/clojure/lang/ExceptionInfo.java')
    expect(rendered.code).toContain('https://github.com/clojure/core.async')
    expect(rendered.code).toContain('/clojure/latest/reference/libtmux-core-snapshot/')
    await (await processor).render('Use `libtmux.core/missing!`, `io.github.libtmux/missing-package` and `libtmux.docs.unknown`.', { frontmatter: { port: 'clojure' } })
    expect(names(own)).toEqual(['libtmux.core/missing!', 'io.github.libtmux/missing-package', 'libtmux.docs.unknown'])
  })

  it('keeps shared tmux prose out of a selected Clojure build report', async () => {
    const own = join(directory, 'clojure-native.jsonl')
    vi.stubEnv('LIBTMUX_DOCS_DANGLING_REPORT', own)
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'clojure')
    const rendered = await (await processor).render('Write `tmux.conf`; capture `=work:editor`.', {
      fileURL: new URL('../src/content/docs/topics/interaction.md', import.meta.url), frontmatter: {},
    })
    expect(names(own)).toEqual([])
    expect(rendered.code).not.toContain('api-mention')
    await (await processor).render('Use `libtmux.core/missing!`.', { frontmatter: { port: 'clojure' } })
    expect(names(own)).toEqual(['libtmux.core/missing!'])
  })

  it('requires a language claim before assigning shared site prose to a facade', async () => {
    const own = join(directory, 'clojure-shared.jsonl')
    vi.stubEnv('LIBTMUX_DOCS_DANGLING_REPORT', own)
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'clojure')
    await (await processor).render('Read `llms.txt` and `sphinx.ext.intersphinx`.', {
      fileURL: new URL('../src/content/docs/meta/exports.md', import.meta.url), frontmatter: {},
    })
    expect(names(own)).toEqual([])
    await (await processor).render('```clojure\n(require libtmux.core)\n```\n\nUse `libtmux.core/missing!`.', { frontmatter: {} })
    expect(names(own)).toEqual(['libtmux.core/missing!'])
  })

  it('is caught when a render adds to the file the check watches, so the check above can fail', async () => {
    const watched = join(directory, 'watched.jsonl')
    vi.stubEnv('LIBTMUX_DOCS_DANGLING_REPORT', watched)
    const before = state(watched)
    await render()
    expect(state(watched)).not.toEqual(before)
  })

  it('links Haskell standard types and tracked project files without reporting them as missing API', async () => {
    const own = join(directory, 'haskell.jsonl')
    vi.stubEnv('LIBTMUX_DOCS_DANGLING_REPORT', own)
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'haskell')
    const { code } = await (await processor).render(
      'Use `IO`, `Either` and `Integer`. Configure `cabal.project` and `libtmux-haskell.cabal`; read `src/LibTmux/Id.hs`. Call `Nope.thing()`.',
      { frontmatter: {} },
    )
    expect(names(own)).toEqual(['Nope.thing()'])
    for (const destination of [
      'https://hackage-content.haskell.org/package/base-4.22.0.0/docs/System-IO.html#t:IO',
      'https://hackage-content.haskell.org/package/base-4.22.0.0/docs/Data-Either.html#t:Either',
      'https://hackage-content.haskell.org/package/base-4.22.0.0/docs/Prelude.html#t:Integer',
      ...['cabal.project', 'libtmux-haskell.cabal', 'src/LibTmux/Id.hs'].map((path) =>
        `https://github.com/libtmux/libtmux-haskell/blob/eda8825caa1ffde21454bb2eb6954bf46d2939af/${path}`),
    ]) expect(code).toContain(`href="${destination}"`)
  })
})

/**
 * The ceiling is the build's gate, and a gate that passes without a report is no gate. These call the integration's hooks as
 * Astro does, over a report the test names, and require a root build to fail when there is nothing to count or too much.
 */
describe('the build\'s ceiling', () => {
  const entry = (index: number) => JSON.stringify({ port: 'py', text: `Name${index}`, why: 'not defined in the stated port' })
  const lines = (count: number) => Array.from({ length: count }, (_, index) => entry(index)).join('\n') + '\n'
  const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
  const done = (log = logger()) => (danglingReport().hooks['astro:build:done'] as (options: unknown) => void)({ logger: log })
  const setup = (command: 'build' | 'dev') => (danglingReport().hooks['astro:config:setup'] as (options: unknown) => void)({ command, config: { cacheDir: pathToFileURL(`${directory}/cache/`) } })
  const report = () => join(directory, 'report.jsonl')
  beforeEach(() => {
    vi.stubEnv('LIBTMUX_DOCS_DANGLING_REPORT', report())
    vi.stubEnv('LIBTMUX_DOCS_PORT', '')
  })

  it('fails a root build that has no report, where nothing ran to write one', () => {
    expect(() => done()).toThrow(/no report at .*report\.jsonl, so the linking pass did not run/)
  })

  it('passes a root build whose report is empty, because the pass ran and found nothing', () => {
    writeFileSync(report(), '')
    const log = logger()
    expect(() => done(log)).not.toThrow()
    expect(log.info).toHaveBeenCalledWith('API links: every mention resolved')
  })

  it('fails a build over the ceiling, and passes one at it', () => {
    writeFileSync(report(), lines(325))
    expect(() => done()).toThrow(/325 unresolved mentions exceeds the ceiling of 60/)
    writeFileSync(report(), lines(60))
    expect(() => done()).not.toThrow()
    writeFileSync(report(), lines(12))
    expect(() => done()).not.toThrow()
  })

  it('leaves a port\'s build alone, which no ceiling counts', () => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'py')
    expect(() => done()).not.toThrow()
    writeFileSync(report(), lines(325))
    expect(() => done()).not.toThrow()
  })

  it('refuses to start a build that inherits VITEST without a report to write', () => {
    expect(process.env.VITEST).toBeTruthy()
    vi.stubEnv('LIBTMUX_DOCS_DANGLING_REPORT', '')
    expect(() => setup('build')).toThrow(/VITEST is set in this build/)
    // A dev server writes nothing the gate reads; a build that names its report is a test's own.
    expect(() => setup('dev')).not.toThrow()
    vi.stubEnv('LIBTMUX_DOCS_DANGLING_REPORT', report())
    expect(() => setup('build')).not.toThrow()
  })

  it('clears the report a build starts from, so a stale one is not this build\'s result', () => {
    writeFileSync(report(), lines(3))
    setup('build')
    expect(existsSync(report())).toBe(false)
    expect(() => done()).toThrow(/no report/)
  })
})

