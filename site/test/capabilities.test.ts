import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const fixtures = join(import.meta.dirname, 'fixtures/capabilities')

/**
 * A tmux checkout holding only release tags, so a run never depends on a clone
 * outside the repository. The generator reads releases from tmux's own refs,
 * and the default path is a developer's clone that a hosted runner lacks.
 */
function tmuxSource() {
  const dir = mkdtempSync(join(tmpdir(), 'tmux-source-'))
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { stdio: 'ignore' })
  git('init', '-q')
  git('commit', '-q', '--allow-empty', '-m', 'release')
  for (const tag of ['3.1', '3.2a', '3.3', '3.3a', '3.4']) git('tag', tag)
  return dir
}

function generate(manifest: string, port = 'py', into?: string) {
  const out = into ?? join(mkdtempSync(join(tmpdir(), 'capabilities-')), 'capabilities.json')
  const run = spawnSync('node', ['scripts/gen-capabilities.mjs', '--port', port, '--manifest', `${port}=${resolve(fixtures, manifest)}`, '--tmux', tmuxSource(), '--out', out], {
    cwd: root,
    encoding: 'utf8',
  })
  return { run, out }
}

/** A fixture manifest with one edit applied, so a test names the single difference. */
function edited(fixture: string, edit: (manifest: any) => void) {
  const manifest = JSON.parse(readFileSync(join(fixtures, fixture), 'utf8'))
  edit(manifest)
  const path = join(mkdtempSync(join(tmpdir(), 'capabilities-manifest-')), 'capabilities.json')
  writeFileSync(path, JSON.stringify(manifest))
  return path
}

describe('gen-capabilities', () => {
  it('links every API name in a manifest to the API model', () => {
    const { run, out } = generate('py.json')
    expect(run.status, run.stderr).toBe(0)
    const data = JSON.parse(readFileSync(out, 'utf8'))
    const entry = data.ports.py.capabilities[0]
    expect(entry.apis).toEqual(['libtmux.Server.new_session'])
    expect(entry.error).toBe('libtmux.exc.VersionTooLow')
    expect(data.releases).toEqual(['3.2a', '3.3', '3.3a', '3.4'])
  })

  it('reads a manifest only for the port that owns the checkout', () => {
    // Kotlin shares libtmux-java's checkout, so the manifest there names java.
    const parent = generate('java.json', 'java')
    expect(parent.run.status, parent.run.stderr).toBe(0)
    expect(Object.keys(JSON.parse(readFileSync(parent.out, 'utf8')).ports)).toEqual(['java'])
    const wrapper = generate('java.json', 'kotlin')
    expect(wrapper.run.status, wrapper.run.stderr).toBe(0)
    expect(JSON.parse(readFileSync(wrapper.out, 'utf8')).ports).toEqual({})
  })

  it('fails on a name the API model does not have', () => {
    const { run } = generate('py-unresolved.json')
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('"libtmux.Server.no_such_method", which is not in the API model')
  })

  // PowerShell raises the C# library's exceptions, so its manifest names types
  // that only the .NET model holds. Reference navigation links those through
  // `apiDependencies`; the generator resolves them the same way.
  it('resolves a name through the model of an API dependency', () => {
    const { run, out } = generate('powershell.json', 'powershell')
    expect(run.status, run.stderr).toBe(0)
    const [control, layout] = JSON.parse(readFileSync(out, 'utf8')).ports.powershell.capabilities
    expect(control.apis).toEqual(['LibTmux\\Connect-TmuxControl'])
    expect(control.error).toBe('LibTmux.TmuxVersionTooLowException')
    expect(layout.error).toBe('LibTmux.TmuxWindowException')
  })

  it('leaves a dependency name unresolved for a port that does not depend on it', () => {
    const goOnly = edited('powershell.json', (m) => { m.port = 'go' })
    const { run } = generate(goOnly, 'go')
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('go: capability control-mode error names "LibTmux.TmuxVersionTooLowException", which is not in the API model')
  })

  it('fails on a dependency name that neither model has', () => {
    const lost = edited('powershell.json', (m) => { m.capabilities[0].error = 'LibTmux.NoSuchException' })
    const { run } = generate(lost, 'powershell')
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('powershell: capability control-mode error names "LibTmux.NoSuchException", which is not in the API model')
  })
})

/**
 * `--check` on a runner that has this repository and nothing else: no port
 * checkout, and so no manifest to read. Hosted CI is that runner.
 */
describe('gen-capabilities --check', () => {
  const missing = '/nonexistent/capabilities.json'
  const fixture = join(fixtures, 'py.json')

  /** Write the committed file the way the generator does, from a fixture (the py one by default). */
  function committed(edit?: (data: any) => void, { manifest = 'py.json', port = 'py' } = {}) {
    const { run, out } = generate(manifest, port)
    expect(run.status, run.stderr).toBe(0)
    if (edit) {
      const data = JSON.parse(readFileSync(out, 'utf8'))
      edit(data)
      writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`)
    }
    return out
  }

  function check(out: string, { manifest = fixture, tmux = tmuxSource(), port = 'py', env = {} }: { manifest?: string, tmux?: string, port?: string, env?: Record<string, string> } = {}) {
    return spawnSync('node', ['scripts/gen-capabilities.mjs', '--check', '--port', port, '--manifest', `${port}=${manifest}`, '--tmux', tmux, '--out', out], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ...env },
    })
  }

  it('passes a current file when the manifest is readable', () => {
    const run = check(committed())
    expect(run.status, run.stderr).toBe(0)
    expect(run.stdout).toContain('is current for 1 of 1 ports')
  })

  it('names a port whose manifest it could not read instead of passing silently', () => {
    const run = check(committed(), { manifest: missing })
    expect(run.status, run.stderr).toBe(0)
    expect(run.stdout).toContain('is current for 0 of 1 ports')
    expect(run.stdout).toContain('manifest not compared: py')
  })

  it('says so when no port has a manifest anywhere', () => {
    const empty = join(mkdtempSync(join(tmpdir(), 'capabilities-')), 'capabilities.json')
    writeFileSync(empty, `${JSON.stringify({ generated: 'scripts/gen-capabilities.mjs', releases: [], ports: {} }, null, 2)}\n`)
    const run = check(empty, { manifest: missing })
    expect(run.status, run.stderr).toBe(0)
    expect(run.stdout).toContain('is current for 0 of 1 ports')
    expect(run.stdout).toContain('no manifest here and none committed: py')
  })

  it('fails a committed name the API model lost, with no manifest to compare', () => {
    const out = committed((data) => { data.ports.py.capabilities[0].apis.push('libtmux.Server.no_such_method') })
    expect(check(out).status).toBe(1)
    const run = check(out, { manifest: missing })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('py: committed capability buffer-delete-named names "libtmux.Server.no_such_method", which is not in the API model')
  })

  it('fails a committed entry that is no longer a valid manifest, with no manifest to compare', () => {
    const run = check(committed((data) => { data.ports.py.capabilities[0].except = '3.5' }), { manifest: missing })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('py: committed entry: capabilities[0].except: expected an array of releases')
  })

  it('fails a file that differs from a manifest it can read', () => {
    const run = check(committed((data) => { data.ports.py.capabilities[0].summary = 'Edited by hand.' }))
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('py: differs from its manifest')
  })

  it('fails a manifest the file does not hold', () => {
    const run = check(committed((data) => { delete data.ports.py }))
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('py: missing from the file')
  })

  it('fails an entry for a port that is not registered', () => {
    const run = check(committed((data) => { data.ports.nope = data.ports.py }), { manifest: missing })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('nope: committed, but not a registered port')
  })

  it('compares releases with tmux when it can, and says when it cannot', () => {
    const out = committed()
    const stale = committed((data) => { data.releases = ['3.3a'] })
    expect(check(stale).stderr).toContain('releases differ from the tmux refs')
    const run = check(out, { tmux: '/nonexistent/tmux' })
    expect(run.status, run.stderr).toBe(0)
    expect(run.stdout).toContain('tmux releases not compared: no tmux checkout at /nonexistent/tmux')
  })

  it('checks committed releases by their form when tmux is absent', () => {
    const below = check(committed((data) => { data.releases = ['3.1', '3.2a', '3.3a', '3.4'] }), { tmux: '/nonexistent/tmux' })
    expect(below.status).toBe(1)
    expect(below.stderr).toContain('release 3.1 is below the lowest floor 3.2a')
    const unsorted = check(committed((data) => { data.releases = ['3.4', '3.3a'] }), { tmux: '/nonexistent/tmux' })
    expect(unsorted.status).toBe(1)
    expect(unsorted.stderr).toContain('releases are not in ascending order')
    const bad = check(committed((data) => { data.releases = ['3.3a', 'master'] }), { tmux: '/nonexistent/tmux' })
    expect(bad.status).toBe(1)
    expect(bad.stderr).toContain('not a version tmux prints')
  })

  it('verifies a committed dependency name against the dependency model, with no manifest to compare', () => {
    const options = { manifest: missing, port: 'powershell' }
    const clean = check(committed(undefined, { manifest: 'powershell.json', port: 'powershell' }), options)
    expect(clean.status, clean.stderr).toBe(0)
    const out = committed((data) => { data.ports.powershell.capabilities[0].error = 'LibTmux.NoSuchException' }, { manifest: 'powershell.json', port: 'powershell' })
    const run = check(out, options)
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('powershell: committed capability control-mode error names "LibTmux.NoSuchException", which is not in the API model')
  })

  it('reads a port\'s manifest from LIBTMUX_DOCS_CHECKOUT_<PORT>', () => {
    const checkout = mkdtempSync(join(tmpdir(), 'port-checkout-'))
    copyFileSync(fixture, join(checkout, 'capabilities.json'))
    const out = join(mkdtempSync(join(tmpdir(), 'capabilities-')), 'capabilities.json')
    // No --manifest: the override alone says where the manifest is.
    const run = (flags: string[], checkoutEnv: string) => spawnSync('node', ['scripts/gen-capabilities.mjs', '--port', 'py', '--tmux', tmuxSource(), '--out', out, ...flags], {
      cwd: root, encoding: 'utf8', env: { ...process.env, LIBTMUX_DOCS_CHECKOUT_PY: checkoutEnv },
    })
    const written = run([], checkout)
    expect(written.status, written.stderr).toBe(0)
    expect(JSON.parse(readFileSync(out, 'utf8')).ports.py.capabilities[0].id).toBe('buffer-delete-named')
    const read = run(['--check'], checkout)
    expect(read.status, read.stderr).toBe(0)
    expect(read.stdout).toContain('is current for 1 of 1 ports')
    // An override with no manifest is named, not replaced by the default checkout.
    const absent = run(['--check'], join(checkout, 'nowhere'))
    expect(absent.status, absent.stderr).toBe(0)
    expect(absent.stdout).toContain('manifest not compared: py')
    // --manifest still wins over the environment.
    const named = check(committed(), { env: { LIBTMUX_DOCS_CHECKOUT_PY: join(checkout, 'nowhere') } })
    expect(named.status, named.stderr).toBe(0)
    expect(named.stdout).toContain('is current for 1 of 1 ports')
  })

  it('refuses to write a file that would drop a port it cannot read', () => {
    const out = committed()
    const before = readFileSync(out, 'utf8')
    const run = spawnSync('node', ['scripts/gen-capabilities.mjs', '--manifest', `py=${missing}`, '--tmux', tmuxSource(), '--out', out], { cwd: root, encoding: 'utf8' })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('refusing to write a partial file')
    expect(readFileSync(out, 'utf8')).toBe(before)
  })

  it('refuses the same when --port selects the port it cannot read', () => {
    const out = committed()
    const before = readFileSync(out, 'utf8')
    const run = spawnSync('node', ['scripts/gen-capabilities.mjs', '--port', 'py', '--manifest', `py=${missing}`, '--tmux', tmuxSource(), '--out', out], { cwd: root, encoding: 'utf8' })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('refusing to write a partial file')
    expect(readFileSync(out, 'utf8')).toBe(before)
  })

  it('keeps the other committed ports when --port rewrites one', () => {
    const out = committed()
    const run = generate('java.json', 'java', out).run
    expect(run.status, run.stderr).toBe(0)
    const data = JSON.parse(readFileSync(out, 'utf8'))
    expect(Object.keys(data.ports).sort()).toEqual(['java', 'py'])
    expect(data.ports.py.capabilities[0].error).toBe('libtmux.exc.VersionTooLow')
    // The py floor is the lowest, so its releases stay although only java was read.
    expect(data.releases).toEqual(['3.2a', '3.3', '3.3a', '3.4'])
    const current = check(out, { manifest: fixture })
    expect(current.status, current.stderr).toBe(0)
  })
})
