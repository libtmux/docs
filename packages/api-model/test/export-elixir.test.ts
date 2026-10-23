import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractElixir } from '../src/languages/elixir.ts'

const script = new URL('../scripts/export-elixir.exs', import.meta.url).pathname
const project = new URL('./fixtures/elixir-project/', import.meta.url).pathname
const env = { ...process.env, MIX_ENV: 'prod', MIX_QUIET: '1' }
// The exporter runs in the port's own toolchain, so the suite needs Elixir 1.18 or newer (the JSON module) on PATH.
const version = /Mix (\d+)\.(\d+)/.exec(spawnSync('mix', ['--version'], { encoding: 'utf8', env, cwd: tmpdir() }).stdout ?? '')
const toolchain = version !== null && (Number(version[1]) > 1 || Number(version[2]) >= 18)

/** CI must have the toolchain, because a skipped suite leaves the exporter untested without a failure. */
const requirement = (available: boolean, ci: string | undefined): 'run' | 'skip' | 'fail' =>
  available ? 'run' : ci && ci !== '0' && ci !== 'false' ? 'fail' : 'skip'
const needed = requirement(toolchain, process.env.CI)

it('fails a missing toolchain on CI and skips it elsewhere', () => {
  expect(requirement(true, 'true')).toBe('run')
  expect(requirement(true, undefined)).toBe('run')
  expect(requirement(false, 'true')).toBe('fail')
  expect(requirement(false, '1')).toBe('fail')
  for (const ci of [undefined, '', '0', 'false']) expect(requirement(false, ci)).toBe('skip')
})

it.runIf(needed === 'fail')('finds Elixir 1.18 or newer and Mix on PATH', () => {
  throw new Error('CI is set but Mix reports no Elixir 1.18 or newer; install the toolchain before the unit tests')
})

/** The fixture project, committed in a directory of its own. */
function checkout() {
  const directory = mkdtempSync(join(tmpdir(), 'export-elixir-'))
  cpSync(project, directory, { recursive: true })
  const git = (...args: string[]) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim()
  git('init', '-q')
  git('add', '.')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture')
  return { directory, revision: git('rev-parse', 'HEAD') }
}

const exportFrom = (directory: string, out = join(directory, '_build/api.json')) =>
  spawnSync('mix', ['run', '--no-start', script, out], { cwd: directory, encoding: 'utf8', env })

// Each case compiles the fixture with Mix, which takes seconds on a loaded or cold runner.
describe.skipIf(needed !== 'run')('Elixir exporter', { timeout: 30_000 }, () => {
  it('describes a compiled application from its documentation chunks and typespecs', () => {
    const { directory, revision } = checkout()
    try {
      const result = exportFrom(directory)
      expect(result.status, result.stderr).toBe(0)
      const artifact = JSON.parse(readFileSync(join(directory, '_build/api.json'), 'utf8'))
      expect(artifact).toMatchObject({
        schema: 1, port: 'elixir', source: { repository: 'libtmux/probe', revision },
        package: { name: 'probe', version: '0.1.0', elixir: '>= 1.20.0' }, exporter: { columns: 60 },
      })
      expect(artifact.source.files.map((file: { path: string }) => file.path)).toEqual(['lib/probe.ex', 'mix.exs'])
      // What ExDoc hides stays out: the module with no documentation and the function marked @doc false.
      const modules = Object.fromEntries(artifact.modules.map((module: { name: string }) => [module.name, module]))
      expect(Object.keys(modules).sort()).toEqual(['Probe', 'Probe.Behaviour', 'Probe.Failure'])
      expect(modules.Probe.members.map((member: { id: string }) => member.id)).not.toContain('Probe.hidden/0')
      expect(modules.Probe).toMatchObject({ kind: 'struct', source: { file: 'lib/probe.ex', line: 1 } })
      expect(modules['Probe.Behaviour'].kind).toBe('behaviour')
      expect(modules['Probe.Failure'].kind).toBe('exception')
      expect(modules['Probe.Failure'].fields.map((field: { name: string }) => field.name)).toEqual(['message', 'code'])
      const member = (id: string) => modules.Probe.members.find((entry: { id: string }) => entry.id === id)
      expect(member('Probe.double/1')).toMatchObject({ since: '0.1.0', specs: [{ returns: 'integer()' }, { returns: 'float()' }] })
      expect(member('Probe.start/2')).toMatchObject({
        defaults: 2, signature: 'start(arguments \\\\ [], options \\\\ [])',
        parameters: [{ name: 'arguments', default: '[]' }, { name: 'options', default: '[]' }],
      })
      expect(member('Probe.twice/1').deprecated).toBe('Use double/1.')
      expect(member('Probe.unless_empty/2')).toMatchObject({ kind: 'macro', specs: [{ parameters: ['list()', 'Macro.t()'], text: '@spec unless_empty(list(), Macro.t()) :: Macro.t()' }] })
      expect(member('Probe.length/1').delegateTo).toBe('Kernel.length/1')
      expect(member('Probe.wrap/1').specs[0].constraints).toEqual([{ name: 'item', type: 'term()' }])
      expect(member('Probe.handle/1')).toMatchObject({ opaque: true, declaration: '@opaque handle(item)' })
      expect(modules['Probe.Behaviour'].members.map((entry: { id: string; kind: string }) => [entry.id, entry.kind])).toEqual([
        ['Probe.Behaviour.open/1', 'callback'], ['Probe.Behaviour.build/1', 'macrocallback'],
      ])
      expect(modules['Probe.Behaviour'].members[0].specs[0].text).toBe('@callback open(keyword()) :: {:ok, term()}')
      // A type that shares a function's name and arity takes a prefix; the function keeps the plain id.
      expect(member('Probe.result/0').kind).toBe('function')
      expect(member('Probe.type:result/0').kind).toBe('type')
      expect(modules.Probe.fields.map((field: { name: string; required: boolean }) => [field.name, field.required])).toEqual([['id', true], ['count', false]])
      // The adapter accepts what the exporter writes, for the revision that was checked out.
      const model = extractElixir(artifact, revision)
      expect(model.symbols.find((symbol) => symbol.id === 'Probe.double/1')).toMatchObject({ modifiers: ['overload'], name: 'double/1' })
      expect(model.symbols.find((symbol) => symbol.id === 'Probe.twice/1')!.modifiers).toContain('deprecated')
      expect(model.symbols.find((symbol) => symbol.id === 'Probe')!.doc?.admonitions).toEqual([{ kind: 'warning', text: '**Careful** Do not call it twice.' }])
      expect(model.symbols.find((symbol) => symbol.id === 'Probe')!.doc?.examples?.[0]).toMatchObject({ lang: 'elixir', code: 'iex> Probe.double(2)\n4' })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('writes the same bytes twice', () => {
    const { directory } = checkout()
    try {
      expect(exportFrom(directory, join(directory, '_build/a.json')).status).toBe(0)
      expect(exportFrom(directory, join(directory, '_build/b.json')).status).toBe(0)
      expect(readFileSync(join(directory, '_build/a.json'), 'utf8')).toBe(readFileSync(join(directory, '_build/b.json'), 'utf8'))
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('refuses a tree with uncommitted changes, because no revision describes it', () => {
    const { directory } = checkout()
    try {
      writeFileSync(join(directory, 'lib/probe.ex'), `${readFileSync(join(directory, 'lib/probe.ex'), 'utf8')}\n# edited\n`)
      const result = exportFrom(directory)
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('uncommitted changes')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('refuses a source_url that is not a GitHub repository', () => {
    const { directory } = checkout()
    try {
      const mix = readFileSync(join(directory, 'mix.exs'), 'utf8').replace('https://github.com/libtmux/probe', 'https://example.org/probe')
      writeFileSync(join(directory, 'mix.exs'), mix)
      execFileSync('git', ['-C', directory, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qam', 'Move'])
      const result = exportFrom(directory)
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('source_url must name a GitHub repository')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
