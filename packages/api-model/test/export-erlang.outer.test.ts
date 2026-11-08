import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

const exportFrom = (directory: string, output = join(directory, '_build/api.json')) =>
  spawnSync('escript', [script, directory, 'probe', output], { encoding: 'utf8', env })

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
      const module = artifact.modules[0]
      expect(module.name).toBe('probe')
      expect(module.doc).toContain('`m:probe` and `read/1`')
      const member = (kind: string, name: string) => module.members.find((m: { kind: string; name: string }) => m.kind === kind && m.name === name)
      expect(member('function', 'hidden')).toBeUndefined()
      expect(member('function', 'double')).toMatchObject({ arity: 1, since: '0.1.0', deprecated: 'Use a calculator.', source: { file: 'src/probe.erl' } })
      expect(member('function', 'double').declarations.join('')).toContain('float()')
      expect(member('function', 'double').declarations.join('')).toContain('integer()')
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
      const repeat = exportFrom(directory)
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
})
