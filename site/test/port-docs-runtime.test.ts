import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url).pathname
const workflow = readFileSync(join(root, '.github/workflows/port-docs.yml'), 'utf8')
const doxygenCheck = join(root, 'scripts/check-doxygen.py')
function script(name: string) {
  const start = workflow.indexOf(`      - name: ${name}\n`)
  expect(start).toBeGreaterThan(-1)
  const body = workflow.slice(start).match(/        run: \|\n((?: {10}[^\n]*\n|\n)*)/)
  expect(body).not.toBeNull()
  return body![1].replace(/^ {10}/gm, '')
}

function selectedVersion(port: string, source?: string) {
  const directory = mkdtempSync(join(tmpdir(), 'libtmux-native-version-'))
  const output = join(directory, 'output')
  try {
    mkdirSync(join(directory, 'port'))
    writeFileSync(output, '')
    if (source !== undefined) writeFileSync(join(directory, 'port', port === 'rs' ? 'rust-toolchain.toml' : '.mise.toml'), source)
    const result = spawnSync('bash', ['-e', '-c', script('Read selected Rust and Swift toolchains')], {
      cwd: directory, encoding: 'utf8', timeout: 5000,
      env: { ...process.env, PORT: port, GITHUB_OUTPUT: output },
    })
    return { ...result, output: readFileSync(output, 'utf8') }
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

function documentationVersion(port: string, source: string) {
  const directory = mkdtempSync(join(tmpdir(), 'libtmux-docs-runtime-'))
  const tooling = join(directory, 'export tooling')
  const output = join(directory, 'output')
  const environment = join(directory, 'environment')
  try {
    mkdirSync(tooling)
    writeFileSync(join(tooling, '.tool-versions'), source)
    writeFileSync(output, '')
    writeFileSync(environment, '')
    const result = spawnSync('bash', ['-e', '-c', script('Read native documentation toolchain')], {
      cwd: directory, encoding: 'utf8', timeout: 5000,
      env: { ...process.env, PORT: port, GENERATOR_CHECKOUT: tooling, GITHUB_OUTPUT: output, GITHUB_ENV: environment },
    })
    return { ...result, output: readFileSync(output, 'utf8'), environment: readFileSync(environment, 'utf8'), tooling }
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

function elixirToolchain(files: Record<string, string | undefined>) {
  const directory = mkdtempSync(join(tmpdir(), 'libtmux-elixir-toolchain-'))
  const output = join(directory, 'output')
  try {
    mkdirSync(join(directory, 'port/priv/tmux'), { recursive: true })
    writeFileSync(output, '')
    for (const [name, content] of Object.entries(files)) {
      if (content !== undefined) writeFileSync(join(directory, 'port', name), content)
    }
    const result = spawnSync('bash', ['-e', '-c', script('Read selected Elixir toolchain')], {
      cwd: directory, encoding: 'utf8', timeout: 5000, env: { ...process.env, GITHUB_OUTPUT: output },
    })
    return { ...result, output: readFileSync(output, 'utf8') }
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

const support = (reference: unknown) => JSON.stringify({ schema_version: 1, reference })
const tracking = 'erlang 29\nelixir 1.20\n'

describe('native documentation producers', () => {
  it.each([0, 23])('uses Julia tooling to build its tmux floor and stops on build failure %s', (exitCode) => {
    const directory = mkdtempSync(join(tmpdir(), 'libtmux-julia-tmux-'))
    const tooling = join(directory, 'export tooling')
    const output = join(directory, 'path')
    const invocations = join(directory, 'invocations')
    const stage = join(directory, 'libtmux-julia-docs')
    try {
      mkdirSync(join(tooling, 'dev'), { recursive: true })
      writeFileSync(output, '')
      writeFileSync(join(directory, 'sudo'), `#!${process.execPath}
require('node:fs').appendFileSync(process.env.TMUX_INVOCATIONS, JSON.stringify(process.argv.slice(2)) + '\\n')
`, { mode: 0o700 })
      writeFileSync(join(directory, 'tmux'), '#!/bin/sh\nprintf "tmux 3.4\\n"\n', { mode: 0o700 })
      writeFileSync(join(tooling, 'dev/check-matrix.py'), `import json, os, pathlib, sys
with open(os.environ['TMUX_INVOCATIONS'], 'a') as output:
    output.write(json.dumps(sys.argv[1:]) + '\\n')
if ${exitCode}: sys.exit(${exitCode})
binary = pathlib.Path(sys.argv[2]) / 'tmux' / sys.argv[3] / 'bin/tmux'
binary.parent.mkdir(parents=True)
binary.write_text('#!/bin/sh\\nprintf "tmux 3.7c\\\\n"\\n')
binary.chmod(0o700)
`)
      const result = spawnSync('bash', ['-e', '-c', script('Install native system dependencies')], {
        cwd: directory, encoding: 'utf8', timeout: 5000,
        env: { ...process.env, PORT: 'julia', PATH: `${directory}:${process.env.PATH}`, LIBTMUX_DOCS_GENERATOR_CHECKOUT: tooling, RUNNER_TEMP: directory, GITHUB_PATH: output, TMUX_INVOCATIONS: invocations },
      })
      expect(result.status, result.stderr).toBe(exitCode)
      const commands = readFileSync(invocations, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
      expect(commands[1]).toEqual(expect.arrayContaining(['libevent-dev', 'libncurses-dev', 'bison', 'build-essential', 'pkg-config']))
      expect(commands[2]).toEqual(['build-tmux', stage, '3.7c'])
      expect(readFileSync(output, 'utf8')).toBe(exitCode ? '' : `${stage}/tmux/3.7c/bin\n`)
      if (!exitCode) expect(result.stdout).toContain('tmux 3.7c')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it.each([
    ['powershell', 'powershell 7.4.20\ndotnet 8.0.425\n', '7.4.20'],
    ['julia', 'julia 1.13.0\n', '1.13.0'],
  ])('reads the exact %s exporter runtime separately from the API source', (port, source, version) => {
    const result = documentationVersion(port, source)
    expect(result.status, result.stderr).toBe(0)
    expect(result.output).toBe(`version=${version}\n`)
    expect(result.environment).toBe(`LIBTMUX_DOCS_GENERATOR_CHECKOUT=${result.tooling}\n`)
  })

  it.each([
    ['powershell', 'powershell latest\n'],
    ['julia', 'julia 1.13.0 injected\n'],
    ['julia', 'julia 1.13.0\njulia 1.10.0\n'],
    ['julia', 'powershell 7.4.20\n'],
    ['ruby', 'ruby 4.0.7\n'],
  ])('rejects ambiguous or unsupported %s tooling before exporting environment values', (port, source) => {
    const result = documentationVersion(port, source)
    expect(result.status).not.toBe(0)
    expect(result.output).toBe('')
    expect(result.environment).toBe('')
  })

  it('rejects a changed PowerShell archive before extraction or PATH publication', () => {
    const directory = mkdtempSync(join(tmpdir(), 'libtmux-powershell-download-'))
    try {
      const output = join(directory, 'path')
      const extracted = join(directory, 'extracted')
      writeFileSync(output, '')
      writeFileSync(join(directory, 'curl'), `#!${process.execPath}
const fs = require('node:fs')
fs.writeFileSync(process.argv[process.argv.indexOf('--output') + 1], 'changed archive')
`, { mode: 0o700 })
      writeFileSync(join(directory, 'tar'), `#!/bin/sh\ntouch '${extracted}'\n`, { mode: 0o700 })
      const result = spawnSync('bash', ['-e', '-c', script('Install tested PowerShell documentation runtime')], {
        cwd: root, encoding: 'utf8', timeout: 5000,
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, POWERSHELL_VERSION: '7.4.20', RUNNER_TEMP: directory, GITHUB_PATH: output },
      })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('computed checksum did NOT match')
      expect(readFileSync(output, 'utf8')).toBe('')
      expect(() => readFileSync(extracted)).toThrow()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('prepares the PowerShell exporter before extracting the selected source checkout', () => {
    const directory = mkdtempSync(join(tmpdir(), 'libtmux-powershell-export-'))
    try {
      const source = join(directory, 'selected source')
      const tooling = join(directory, 'export tooling')
      const output = join(directory, 'invocations')
      mkdirSync(source)
      mkdirSync(tooling)
      writeFileSync(join(directory, 'pwsh'), `#!${process.execPath}
require('node:fs').appendFileSync(process.env.EXPORT_INVOCATIONS, JSON.stringify(process.argv.slice(2)) + '\\n')
`, { mode: 0o700 })
      const result = spawnSync('bash', ['-e', '-c', script('Export PowerShell API from the selected source')], {
        cwd: source, encoding: 'utf8', timeout: 5000,
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, LIBTMUX_DOCS_GENERATOR_CHECKOUT: tooling, EXPORT_INVOCATIONS: output },
      })
      expect(result.status, result.stderr).toBe(0)
      expect(readFileSync(output, 'utf8').trim().split('\n').map((line) => JSON.parse(line))).toEqual([
        ['-NoLogo', '-NoProfile', '-File', join(tooling, 'eng/Setup.ps1')],
        ['-NoLogo', '-NoProfile', '-File', join(tooling, 'eng/Export-Docs.ps1'), '-SourceRoot', source, '-Restore'],
      ])
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})

describe('Elixir documentation producer', () => {
  it('reads the exact reference runtimes that .tool-versions release lines select', () => {
    const result = elixirToolchain({ '.tool-versions': tracking, 'priv/tmux/support.json': support({ otp: '29.1.2', elixir: '1.20.4' }) })
    expect(result.status, result.stderr).toBe(0)
    expect(result.output).toBe('otp-version=29.1.2\nelixir-version=1.20.4\n')
  })

  it.each([
    ['an OTP release line', tracking, { otp: '29', elixir: '1.20.4' }],
    ['an Elixir release line', tracking, { otp: '29.1.2', elixir: '1.20' }],
    ['a range', tracking, { otp: '29.1.2', elixir: '>= 1.20.4' }],
    ['an injected output line', tracking, { otp: '29.1.2', elixir: '1.20.4\nINJECTED=yes' }],
    ['a missing OTP pin', tracking, { elixir: '1.20.4' }],
    ['a non-string pin', tracking, { otp: 29.1, elixir: '1.20.4' }],
    ['an OTP major that .tool-versions does not select', 'erlang 28\nelixir 1.20\n', { otp: '29.1.2', elixir: '1.20.4' }],
    ['an Elixir line that .tool-versions does not select', 'erlang 29\nelixir 1.19\n', { otp: '29.1.2', elixir: '1.20.4' }],
    ['a prefix that is not a version boundary', 'erlang 2\nelixir 1.20\n', { otp: '29.1.2', elixir: '1.20.4' }],
    ['a duplicated tool line', 'erlang 29\nerlang 29\nelixir 1.20\n', { otp: '29.1.2', elixir: '1.20.4' }],
    ['a missing tool line', 'elixir 1.20\n', { otp: '29.1.2', elixir: '1.20.4' }],
    ['an extra field on a tool line', 'erlang 29 injected\nelixir 1.20\n', { otp: '29.1.2', elixir: '1.20.4' }],
  ])('rejects %s without writing outputs', (_name, versions, reference) => {
    const result = elixirToolchain({ '.tool-versions': versions, 'priv/tmux/support.json': support(reference) })
    expect(result.status).not.toBe(0)
    expect(result.output).toBe('')
  })

  it.each([
    ['support policy', { '.tool-versions': tracking }],
    ['.tool-versions', { 'priv/tmux/support.json': support({ otp: '29.1.2', elixir: '1.20.4' }) }],
  ])('rejects a source without its %s', (_name, files) => {
    const result = elixirToolchain(files)
    expect(result.status).not.toBe(0)
    expect(result.output).toBe('')
  })

  function exporter(failing = '') {
    const directory = mkdtempSync(join(tmpdir(), 'libtmux-elixir-export-'))
    try {
      const source = join(directory, 'selected source')
      const output = join(directory, 'invocations')
      mkdirSync(source)
      writeFileSync(join(directory, 'mix'), `#!${process.execPath}
const fs = require('node:fs')
fs.appendFileSync(process.env.EXPORT_INVOCATIONS, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), env: process.env.MIX_ENV }) + '\\n')
if (process.argv[2] === process.env.FAILING_TASK) process.exit(23)
`, { mode: 0o700 })
      const result = spawnSync('bash', ['-e', '-c', script('Export Elixir API from the selected source')], {
        cwd: source, encoding: 'utf8', timeout: 5000,
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, MIX_ENV: 'prod', EXPORTER: join(directory, 'docs/export-elixir.exs'),
          EXPORT_INVOCATIONS: output, FAILING_TASK: failing },
      })
      const calls = readFileSync(output, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
      return { result, calls, source: realpathSync(source), exporter: join(directory, 'docs/export-elixir.exs') }
    } finally { rmSync(directory, { recursive: true, force: true }) }
  }

  it('fetches production dependencies, then exports from the source into the path the model reads', () => {
    const { result, calls, source, exporter: exportScript } = exporter()
    expect(result.status, result.stderr).toBe(0)
    expect(calls).toEqual([
      { argv: ['deps.get', '--only', 'prod'], cwd: source, env: 'prod' },
      { argv: ['run', '--no-start', exportScript, '_build/docs/api.json'], cwd: source, env: 'prod' },
    ])
  })

  it.each(['deps.get', 'run'])('stops when mix %s fails', (task) => {
    const { result, calls } = exporter(task)
    expect(result.status).toBe(23)
    expect(calls.map((call) => call.argv[0])).toEqual(task === 'deps.get' ? ['deps.get'] : ['deps.get', 'run'])
  })

  it('installs exact runtimes before exporting with this repository\'s script', () => {
    const read = workflow.indexOf('name: Read selected Elixir toolchain')
    const setup = workflow.indexOf('uses: erlef/setup-beam@')
    const exportStep = workflow.indexOf('name: Export Elixir API from the selected source')
    const build = workflow.indexOf("name: Build this port's tree")
    expect(read).toBeGreaterThan(workflow.indexOf('name: Snapshot source inputs before native generation'))
    expect(read).toBeLessThan(setup)
    expect(setup).toBeLessThan(exportStep)
    expect(exportStep).toBeLessThan(build)
    const setupStep = workflow.slice(workflow.lastIndexOf('\n      - ', setup), exportStep)
    expect(setupStep).toMatch(/uses: erlef\/setup-beam@[0-9a-f]{40} # v\d+\.\d+\.\d+\n/)
    expect(setupStep).toContain("if: matrix.port == 'elixir'")
    expect(setupStep).toContain('otp-version: ${{ steps.elixir-runtime.outputs.otp-version }}')
    expect(setupStep).toContain('elixir-version: ${{ steps.elixir-runtime.outputs.elixir-version }}')
    expect(setupStep).toContain('version-type: strict')
    expect(workflow.slice(exportStep, build)).toContain('EXPORTER: ${{ github.workspace }}/docs/packages/api-model/scripts/export-elixir.exs')
    expect(existsSync(join(root, 'packages/api-model/scripts/export-elixir.exs'))).toBe(true)
  })

  it('writes the artifact the API model step reads', () => {
    const model = readFileSync(join(root, 'scripts/gen-api-model.mjs'), 'utf8')
    const artifact = /\belixir: \{[^}]*nativeArtifact: '([^']+)'/.exec(model)?.[1]
    expect(artifact).toBeDefined()
    expect(script('Export Elixir API from the selected source')).toContain(` ${artifact}\n`)
  })
})

function doxygenProbe(version: string, aliases = 1, overloads = 2, protection = 'public') {
  const directory = mkdtempSync(join(tmpdir(), 'libtmux-doxygen-test-'))
  try {
    const binary = join(directory, 'doxygen')
    writeFileSync(binary, `#!${process.execPath}
const fs = require('node:fs')
if (process.argv[2] === '--version') {
  console.log(${JSON.stringify(version)})
  process.exit(0)
}
const source = fs.readFileSync('query.hpp', 'utf8')
if (!source.includes('using tmuxq::matching;')) process.exit(91)
fs.mkdirSync('xml')
const member = name => '<memberdef kind="function" prot="${protection}"><qualifiedname>' + name + '</qualifiedname></memberdef>'
fs.writeFileSync('xml/namespacelibtmux.xml', '<doxygen><compounddef>' +
  Array(${aliases}).fill(member('libtmux::matching')).join('') +
  Array(${overloads}).fill(member('libtmux::tmuxq::matching')).join('') + '</compounddef></doxygen>')
`, { mode: 0o700 })
    return spawnSync('python3', [doxygenCheck, binary, '1.18.0'], {
      encoding: 'utf8', timeout: 5000,
    })
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

describe('C++ Doxygen producer', () => {
  it('checks the downloaded producer before exposing it to every XML generation step', () => {
    const install = workflow.indexOf('name: Install tested Doxygen producer')
    const core = workflow.indexOf('name: Generate the Doxygen XML')
    const companions = workflow.indexOf("name: Build this port's tree")
    expect(install).toBeGreaterThan(-1)
    expect(install).toBeLessThan(core)
    expect(core).toBeLessThan(companions)
    expect(workflow.slice(install, install + 150)).toContain("if: matrix.port == 'cxx'")
    expect(script('Install native system dependencies')).not.toMatch(/packages\+=\([^)]*\bdoxygen\b/)
    const body = script('Install tested Doxygen producer')
    expect(body).toContain('version=1.18.0')
    expect(body).toContain('https://github.com/doxygen/doxygen/releases/download/Release_1_18_0/')
    expect(body).toContain('14fa81bdc34171edb5f1f02b1d60e74802f0439b77fa44e592565d517d72df90')
    expect(body.indexOf('sha256sum --check --strict')).toBeLessThan(body.indexOf('tar -xzf'))
    expect(body.indexOf('python3 scripts/check-doxygen.py')).toBeLessThan(body.indexOf('>> "$GITHUB_PATH"'))
    expect(body).toContain('printf \'%s\\n\' "$bin" >> "$GITHUB_PATH"')
  })

  it('rejects a changed archive before extraction or PATH publication', () => {
    const directory = mkdtempSync(join(tmpdir(), 'libtmux-doxygen-download-'))
    try {
      const output = join(directory, 'path')
      const extracted = join(directory, 'extracted')
      writeFileSync(output, '')
      writeFileSync(join(directory, 'curl'), `#!${process.execPath}
const fs = require('node:fs')
fs.writeFileSync(process.argv[process.argv.indexOf('--output') + 1], 'changed archive')
`, { mode: 0o700 })
      writeFileSync(join(directory, 'tar'), `#!/bin/sh\ntouch '${extracted}'\n`, { mode: 0o700 })
      const result = spawnSync('bash', ['-e', '-c', script('Install tested Doxygen producer')], {
        cwd: root, encoding: 'utf8', timeout: 5000,
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, RUNNER_TEMP: directory, GITHUB_PATH: output },
      })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('computed checksum did NOT match')
      expect(readFileSync(output, 'utf8')).toBe('')
      expect(() => readFileSync(extracted)).toThrow()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it.each(['1.18.0', '1.18.0 (8e760943e5d9581a444cf327f43a0b4d20d29482)'])(
    'accepts %s with the public alias and both original overloads', (version) => {
      const result = doxygenProbe(version)
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain('public using-declaration and two original overloads verified')
    },
  )

  it.each(['1.9.8', '1.14.0', '1.18.1', '1.18.0 unexpected'])(
    'rejects an untested producer %s', (version) => {
      const result = doxygenProbe(version)
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('Expected Doxygen 1.18.0')
    },
  )

  it.each([[0, 2, 'public'], [2, 2, 'public'], [1, 1, 'public'], [1, 2, 'private']] as const)(
    'rejects %s aliases, %s original overloads, and %s visibility', (aliases, overloads, protection) => {
      const result = doxygenProbe('1.18.0', aliases, overloads, protection)
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('must emit the public libtmux::matching using-declaration')
    },
  )
})

describe('selected MCP runtime provisioning', () => {
  it.each([
    ['rs', '[toolchain]\nchannel = "1.97.1"\n', '1.97.1'],
    ['rs', '[toolchain]\nchannel = "nightly-2026-09-01"\n', 'nightly-2026-09-01'],
    ['swift', '[tools]\nswift = "6.2.4"\n', '6.2.4'],
  ])('reads %s from the selected checkout', (port, source, version) => {
    const result = selectedVersion(port, source)
    expect(result.status, result.stderr).toBe(0)
    expect(result.output).toBe(`version=${version}\n`)
  })

  it.each([
    ['rs', '[toolchain]\nchannel = "stable"\n'],
    ['rs', '[toolchain]\nchannel = "1.97.1\\nINJECTED=yes"\n'],
    ['rs', '[toolchain]\nchannel = ["1.97.1"]\n'],
    ['swift', '[tools]\nswift = "latest"\n'],
    ['swift', '[tools]\nswift = "6.2.4\\rINJECTED=yes"\n'],
    ['swift', '[tools]\nswift = 6.2\n'],
    ['rs', undefined],
    ['swift', undefined],
  ])('rejects missing or unpinned %s constraints without writing outputs', (port, source) => {
    const result = selectedVersion(port!, source)
    expect(result.status).not.toBe(0)
    expect(result.output).toBe('')
  })

  it.each([
    ['go', true], ['py', true], ['ruby', true],
    ['lua', false], ['kotlin', false], ['scala', false], ['fsharp', false], ['powershell', false], ['julia', true], ['elixir', false],
  ])('uses the product catalog for %s runtime availability', (port, required) => {
    const directory = mkdtempSync(join(tmpdir(), 'libtmux-mcp-availability-'))
    try {
      const output = join(directory, 'output')
      writeFileSync(output, '')
      const result = spawnSync('bash', ['-e', '-c', script('Resolve MCP availability from the port catalog')], {
        cwd: root, encoding: 'utf8', timeout: 5000,
        env: { ...process.env, PORT: String(port), GITHUB_OUTPUT: output },
      })
      expect(result.status, result.stderr).toBe(0)
      expect(readFileSync(output, 'utf8')).toBe(`required=${required}\n`)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it.each(['6.2.4', '6.2.3', 'unrecognized'])('verifies the installed Swift compiler reports %s before adding it to PATH', (version) => {
    const directory = mkdtempSync(join(tmpdir(), 'libtmux-swift-version-'))
    try {
      const bin = join(directory, 'bin')
      const output = join(directory, 'path')
      mkdirSync(bin)
      writeFileSync(output, '')
      writeFileSync(join(bin, 'mise'), '#!/bin/sh\nprintf "%s\\n" "$STUB_TOOLCHAIN"\n', { mode: 0o700 })
      writeFileSync(join(bin, 'swift'), `#!/bin/sh\nprintf '%s\\n' 'Swift version ${version} (fixture)'\n`, { mode: 0o700 })
      const result = spawnSync('bash', ['-e', '-c', script('Verify selected Swift toolchain')], {
        cwd: directory, encoding: 'utf8', timeout: 5000,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_TOOLCHAIN: directory, SWIFT_VERSION: '6.2.4', GITHUB_PATH: output },
      })
      if (version === '6.2.4') {
        expect(result.status, result.stderr).toBe(0)
        expect(readFileSync(output, 'utf8')).toBe(`${bin}\n`)
      } else {
        expect(result.status).not.toBe(0)
        expect(result.stderr).toContain('Expected Swift 6.2.4')
        expect(readFileSync(output, 'utf8')).toBe('')
      }
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('installs the separate Python MCP checkout without altering the captured inputs', () => {
    const snapshot = workflow.indexOf('name: Snapshot source inputs before native generation')
    const runtime = workflow.indexOf("name: Install Python's separate MCP runtime")
    const build = workflow.indexOf("name: Build this port's tree")
    expect(snapshot).toBeLessThan(runtime)
    expect(runtime).toBeLessThan(build)
    expect(workflow.slice(runtime, runtime + 220)).toContain('working-directory: python-mcp')
    expect(workflow.slice(runtime, runtime + 220)).toContain('uv sync --frozen --no-dev')
    expect(workflow).toContain('go-version-file: port/mcp/go.mod\n          cache: false')
    expect(workflow).toContain('global-json-file: port/global.json\n          cache: false')
    expect(workflow).toContain('cache-disabled: true')
    expect(workflow).toContain('bundler-cache: false')
    expect(workflow).toContain('validate-wrappers: true')
    expect(workflow).toContain('bun-version-file: port/package.json\n          no-cache: true')
    expect(workflow).toContain('run: bun install --frozen-lockfile')
    expect(workflow).toContain("BUNDLE_FROZEN: 'true'")
  })
})
