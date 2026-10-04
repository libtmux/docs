import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
    if (source !== undefined)
      writeFileSync(join(directory, 'port', port === 'rs' ? 'rust-toolchain.toml' : '.mise.toml'), source)
    const result = spawnSync('bash', ['-e', '-c', script('Read selected Rust and Swift toolchains')], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, PORT: port, GITHUB_OUTPUT: output },
    })
    return { ...result, output: readFileSync(output, 'utf8') }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function doxygenProbe(version: string, aliases = 1, overloads = 2, protection = 'public') {
  const directory = mkdtempSync(join(tmpdir(), 'libtmux-doxygen-test-'))
  try {
    const binary = join(directory, 'doxygen')
    writeFileSync(
      binary,
      `#!${process.execPath}
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
`,
      { mode: 0o700 },
    )
    return spawnSync('python3', [doxygenCheck, binary, '1.18.0'], {
      encoding: 'utf8',
      timeout: 5000,
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
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
      writeFileSync(
        join(directory, 'curl'),
        `#!${process.execPath}
const fs = require('node:fs')
fs.writeFileSync(process.argv[process.argv.indexOf('--output') + 1], 'changed archive')
`,
        { mode: 0o700 },
      )
      writeFileSync(join(directory, 'tar'), `#!/bin/sh\ntouch '${extracted}'\n`, { mode: 0o700 })
      const result = spawnSync('bash', ['-e', '-c', script('Install tested Doxygen producer')], {
        cwd: root,
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, RUNNER_TEMP: directory, GITHUB_PATH: output },
      })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('computed checksum did NOT match')
      expect(readFileSync(output, 'utf8')).toBe('')
      expect(() => readFileSync(extracted)).toThrow()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it.each(['1.18.0', '1.18.0 (8e760943e5d9581a444cf327f43a0b4d20d29482)'])(
    'accepts %s with the public alias and both original overloads',
    (version) => {
      const result = doxygenProbe(version)
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain('public using-declaration and two original overloads verified')
    },
  )

  it.each(['1.9.8', '1.14.0', '1.18.1', '1.18.0 unexpected'])('rejects an untested producer %s', (version) => {
    const result = doxygenProbe(version)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Expected Doxygen 1.18.0')
  })

  it.each([
    [0, 2, 'public'],
    [2, 2, 'public'],
    [1, 1, 'public'],
    [1, 2, 'private'],
  ] as const)('rejects %s aliases, %s original overloads, and %s visibility', (aliases, overloads, protection) => {
    const result = doxygenProbe('1.18.0', aliases, overloads, protection)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('must emit the public libtmux::matching using-declaration')
  })
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
    ['go', true],
    ['py', true],
    ['ruby', true],
    ['lua', false],
    ['kotlin', false],
    ['scala', false],
    ['fsharp', false],
  ])('uses the product catalog for %s runtime availability', (port, required) => {
    const directory = mkdtempSync(join(tmpdir(), 'libtmux-mcp-availability-'))
    try {
      const output = join(directory, 'output')
      writeFileSync(output, '')
      const result = spawnSync('bash', ['-e', '-c', script('Resolve MCP availability from the port catalog')], {
        cwd: root,
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, PORT: String(port), GITHUB_OUTPUT: output },
      })
      expect(result.status, result.stderr).toBe(0)
      expect(readFileSync(output, 'utf8')).toBe(`required=${required}\n`)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it.each(['6.2.4', '6.2.3', 'unrecognized'])(
    'verifies the installed Swift compiler reports %s before adding it to PATH',
    (version) => {
      const directory = mkdtempSync(join(tmpdir(), 'libtmux-swift-version-'))
      try {
        const bin = join(directory, 'bin')
        const output = join(directory, 'path')
        mkdirSync(bin)
        writeFileSync(output, '')
        writeFileSync(join(bin, 'mise'), '#!/bin/sh\nprintf "%s\\n" "$STUB_TOOLCHAIN"\n', { mode: 0o700 })
        writeFileSync(join(bin, 'swift'), `#!/bin/sh\nprintf '%s\\n' 'Swift version ${version} (fixture)'\n`, {
          mode: 0o700,
        })
        const result = spawnSync('bash', ['-e', '-c', script('Verify selected Swift toolchain')], {
          cwd: directory,
          encoding: 'utf8',
          timeout: 5000,
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            STUB_TOOLCHAIN: directory,
            SWIFT_VERSION: '6.2.4',
            GITHUB_PATH: output,
          },
        })
        if (version === '6.2.4') {
          expect(result.status, result.stderr).toBe(0)
          expect(readFileSync(output, 'utf8')).toBe(`${bin}\n`)
        } else {
          expect(result.status).not.toBe(0)
          expect(result.stderr).toContain('Expected Swift 6.2.4')
          expect(readFileSync(output, 'utf8')).toBe('')
        }
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    },
  )

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
