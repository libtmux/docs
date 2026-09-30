import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url).pathname
const workflow = readFileSync(join(root, '.github/workflows/port-docs.yml'), 'utf8')
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
    ['lua', false], ['kotlin', false], ['scala', false], ['fsharp', false],
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
