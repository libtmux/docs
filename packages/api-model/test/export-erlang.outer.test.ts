import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = new URL('../scripts/export-erlang.escript', import.meta.url).pathname
const fixture = new URL('./fixtures/erlang-project/', import.meta.url).pathname
const env = { ...process.env, ERL_FLAGS: '+S 2:2' }
const version = spawnSync('erl', ['-noshell', '-eval', 'io:put_chars(erlang:system_info(otp_release)), halt().'], { encoding: 'utf8', env }).stdout
const available = version === '29' && spawnSync('rebar3', ['version'], { encoding: 'utf8', env }).status === 0
const ci = !!process.env.CI && !['0', 'false'].includes(process.env.CI)

it('requires OTP 29 on CI for the compiler exporter', () => {
  if (!available && ci) throw new Error('Install Erlang/OTP 29 and Rebar3 before the exporter tests')
})

function checkout() {
  const directory = mkdtempSync(join(tmpdir(), 'export-erlang-'))
  cpSync(fixture, directory, { recursive: true })
  const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim()
  git('init', '-q')
  git('remote', 'add', 'origin', 'https://github.com/libtmux/probe.git')
  git('add', '.')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture')
  return { directory, git, revision: git('rev-parse', 'HEAD') }
}

const exportFrom = (directory: string, output = join(directory, '_build/api.json'), environment = env) =>
  spawnSync('escript', [script, directory, 'probe', output], { encoding: 'utf8', env: environment })

// These cases compile a real OTP project; they belong outside the medium loop.
describe.skipIf(!available)('Erlang compiler export', { timeout: 30_000 }, () => {
  it('retains native declarations, documentation, source identity and hiding', () => {
    const { directory, revision } = checkout()
    try {
      const result = exportFrom(directory)
      expect(result.status, result.stderr + result.stdout).toBe(0)
      const artifact = JSON.parse(readFileSync(join(directory, '_build/api.json'), 'utf8'))
      expect(artifact).toMatchObject({ schema: 1, port: 'erlang', source: { repository: 'libtmux/probe', revision }, package: { name: 'probe', version: '0.1.0' } })
      expect(artifact.source.files.map((file: { path: string }) => file.path)).toContain('src/probe.erl')
      expect(artifact.exporter.source_sha256).toBe(createHash('sha256').update(readFileSync(script)).digest('hex'))
      const module = artifact.modules[0]
      expect(module.name).toBe('probe')
      expect(module.doc).toContain('`m:probe` and `read/1`')
      const member = (kind: string, name: string) => module.members.find((m: { kind: string; name: string }) => m.kind === kind && m.name === name)
      const parameter = member('function', 'read').specs[0].parameters[0]
      expect(parameter.references).toEqual([
        { start: 0, end: 6, target: 't:probe:handle/0' },
      ])
      expect(member('type', 'handle').declaration_references).toEqual([[]])
      expect(member('function', 'hidden')).toBeUndefined()
      expect(member('function', 'wide').specs[0].text.split('\n')
        .every((line: string) => Array.from(line).length <= 60)).toBe(true)
      expect(member('function', 'double')).toMatchObject({ arity: 1, since: '0.1.0', deprecated: 'Use a calculator.', source: { file: 'src/probe.erl' } })
      expect(member('function', 'double').declarations.join('')).toContain('float()')
      expect(member('function', 'double').declarations.join('')).toContain('integer()')
      expect(member('function', 'double').specs).toEqual([
        expect.objectContaining({ parameters: [expect.objectContaining({ name: 'Number', type: 'integer()' })], returns: 'integer()' }),
        expect.objectContaining({ parameters: [expect.objectContaining({ name: 'Number', type: 'float()' })], returns: 'float()' }),
      ])
      const linked = member('function', 'links').specs[0]
      const parameterTargets = linked.parameters[0].references.map((ref: { target: string }) => ref.target)
      expect(parameterTargets).toEqual([
        't:probe:container/3', 't:probe:box/0', '#probe:row{}',
        't:probe:box/0', "t:probe:'🧭'/0",
      ])
      const returned = linked.returns_references
      expect(returned.map((ref: { target: string }) => ref.target)).toEqual([
        "t:probe:'a::b'/0", 't:probe:box/1', 't:erlang:term/0', 't:file:filename_all/0',
      ])
      expect(returned.at(-1).external).toEqual({
        href: 'https://www.erlang.org/doc/apps/kernel/file.html#t:filename_all/0',
        project: 'Erlang/OTP',
      })
      expect(member('type', 'unresolved').declaration_references[0]).toEqual([
        expect.objectContaining({ target: 't:file:no_such_type/0' }),
      ])
      expect(member('type', 'unresolved').declaration_references[0][0].external).toBeUndefined()
      for (const ref of returned) {
        expect(linked.returns.slice(ref.start, ref.end)).not.toContain('literal')
      }
      expect(member('type', 'λ-handle').display_name).toBe("'λ-handle'")
      expect(member('type', 'handle')).toMatchObject({ visibility: 'opaque', declarations: ['-opaque handle().'] })
      expect(JSON.stringify(artifact)).not.toContain('private_token')
      expect(member('type', 'id').declarations.join('')).toContain('-nominal id()')
      expect.soft(member('type', 'internal_mode')).toMatchObject({ exported: false })
      expect.soft(member('type', 'odd-name').declarations).toEqual(["-opaque 'odd-name'(T)."])
      expect.soft(member('type', 'λ-handle').declarations).toEqual(["-opaque 'λ-handle'(T)."])
      expect.soft(member('type', 'included_id').source).toEqual({ file: 'include/public_types.hrl', line: 2 })
      expect(member('callback', 'prepare').declarations.join('')).toContain('-callback prepare(')
      expect(module.records[0]).toMatchObject({ name: 'row' })
      expect(module.records[0].declaration).toContain('-record #row{')
      expect(module.members.every((m: { source: { line: number } }) => m.source.line > 0)).toBe(true)
      const first = readFileSync(join(directory, '_build/api.json'), 'utf8')
      const repository = new URL('../../../', import.meta.url).pathname
      const repeat = spawnSync('escript', [relative(repository, script), relative(repository, directory), 'probe', join(directory, '_build/api.json')],
        { cwd: repository, encoding: 'utf8', env })
      expect(repeat.status, repeat.stderr).toBe(0)
      expect(readFileSync(join(directory, '_build/api.json'), 'utf8')).toBe(first)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('rejects dirty sources and unreadable chunks without writing an artifact', () => {
    const { directory, git } = checkout()
    try {
      const source = join(directory, 'src/probe.erl')
      writeFileSync(source, `${readFileSync(source, 'utf8')}\n% changed\n`)
      expect(exportFrom(directory).stderr).toContain('uncommitted changes')
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qam', 'Change')
      writeFileSync(join(directory, 'rebar.config'), '{erl_opts, [no_docs, no_debug_info]}.\n{deps, []}.\n')
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qam', 'Strip chunks')
      const failure = exportFrom(directory)
      expect(failure.status).not.toBe(0)
      expect(failure.stderr).toContain('compiler chunks')
      expect(spawnSync('test', ['-e', join(directory, '_build/api.json')]).status).toBe(1)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('rejects an external public header even when its basename matches a tracked header', () => {
    const { directory, git } = checkout()
    const outside = mkdtempSync(join(tmpdir(), 'export-erlang-header-'))
    try {
      const header = join(outside, 'public_types.hrl')
      writeFileSync(header, '-type outsourced() :: binary().\n')
      const source = join(directory, 'src/probe.erl')
      writeFileSync(source, readFileSync(source, 'utf8').replace('-module(probe).',
        `-module(probe).\n-export_type([outsourced/0]).\n-include("${header}").`))
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qam', 'Include external type')
      const result = exportFrom(directory)
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('public_types.hrl: source path is missing or ambiguous')
    } finally {
      rmSync(directory, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('captures compiler macros when identical headers have different source provenance', () => {
    const { directory, git } = checkout()
    const outside = mkdtempSync(join(tmpdir(), 'export-erlang-macro-'))
    try {
      const header = join(outside, 'public_types.hrl')
      cpSync(join(directory, 'include/public_types.hrl'), header)
      const source = join(directory, 'src/probe.erl')
      writeFileSync(source, readFileSync(source, 'utf8').replace('-include("public_types.hrl").',
        `-ifdef(USE_EXTERNAL).\n-include("${header}").\n-else.\n-include("public_types.hrl").\n-endif.`))
      const config = join(directory, 'rebar.config')
      writeFileSync(config, readFileSync(config, 'utf8').replace('deterministic,',
        "deterministic, {d, 'USE_EXTERNAL'},"))
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qam', 'Select identical external header')
      const result = exportFrom(directory)
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('public_types.hrl: source path is missing or ambiguous')
    } finally {
      rmSync(directory, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('rejects an external header that remaps itself to a tracked source', () => {
    const { directory, git } = checkout()
    const outside = mkdtempSync(join(tmpdir(), 'export-erlang-remap-'))
    try {
      const header = join(outside, 'public_types.hrl')
      writeFileSync(header, '-file("include/public_types.hrl", 1).\n-type outsourced() :: binary().\n')
      const source = join(directory, 'src/probe.erl')
      writeFileSync(source, readFileSync(source, 'utf8').replace('-module(probe).',
        `-module(probe).\n-export_type([outsourced/0]).\n-include("${header}").`))
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qam', 'Remap external header')
      const result = exportFrom(directory)
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('explicit source remapping cannot be verified')
    } finally {
      rmSync(directory, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('rejects a tracked source symlink instead of citing its target bytes', () => {
    const { directory, git } = checkout()
    const outside = mkdtempSync(join(tmpdir(), 'export-erlang-link-'))
    try {
      const header = join(outside, 'public_types.hrl')
      const tracked = join(directory, 'include/public_types.hrl')
      cpSync(tracked, header)
      rmSync(tracked)
      symlinkSync(header, tracked)
      git('add', '.')
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Link external source')
      const result = exportFrom(directory)
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('source input must be a regular file')
    } finally {
      rmSync(directory, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('binds the primary source to the compiler entry rather than a same-named tracked file', () => {
    const { directory, git } = checkout()
    const outside = mkdtempSync(join(tmpdir(), 'export-erlang-entry-'))
    try {
      const external = join(outside, 'probe.erl')
      cpSync(join(directory, 'src/probe.erl'), external)
      mkdirSync(join(directory, 'unused'))
      git('mv', 'src/probe.erl', 'unused/probe.erl')
      symlinkSync(external, join(directory, 'src/probe.erl'))
      const ignore = join(directory, '.gitignore')
      writeFileSync(ignore, `${readFileSync(ignore, 'utf8')}\nsrc/probe.erl\n`)
      git('add', '.')
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Compile ignored external source')
      const result = exportFrom(directory)
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('probe.erl: source path is missing or ambiguous')
    } finally {
      rmSync(directory, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('resolves include_lib in the compiler VM instead of the exporter library path', () => {
    const { directory, git } = checkout()
    const outside = mkdtempSync(join(tmpdir(), 'export-erlang-library-'))
    try {
      const tracked = join(directory, 'vendor/aliaslib')
      const external = join(outside, 'aliaslib')
      for (const library of [tracked, external]) {
        mkdirSync(join(library, 'include'), { recursive: true })
        mkdirSync(join(library, 'ebin'))
        writeFileSync(join(library, 'include/public_types.hrl'), '-type outsourced() :: binary().\n')
        writeFileSync(join(library, 'ebin/aliaslib.app'), '{application, aliaslib, [{vsn, "0.1.0"}, {modules, []}]}.\n')
      }
      writeFileSync(join(directory, 'rebar.config.script'),
        `true = code:add_patha(${JSON.stringify(join(external, 'ebin'))}), CONFIG.\n`)
      const source = join(directory, 'src/probe.erl')
      writeFileSync(source, readFileSync(source, 'utf8').replace('-module(probe).',
        '-module(probe).\n-export_type([outsourced/0]).\n-include_lib("aliaslib/include/public_types.hrl").'))
      git('add', '.')
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Select compiler library path')
      const result = exportFrom(directory, undefined, { ...env, ERL_LIBS: join(directory, 'vendor') })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('public_types.hrl: source path is missing or ambiguous')
    } finally {
      rmSync(directory, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })
})
