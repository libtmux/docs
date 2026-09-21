import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { PORTS } from '../src/lib/ports'

const reusable = readFileSync(new URL('../../.github/workflows/reusable-deploy.yml', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../../.github/workflows/deploy-shell.yml', import.meta.url), 'utf8')
const testWorkflow = readFileSync(new URL('../../.github/workflows/test.yml', import.meta.url), 'utf8')
const publicationAudit = readFileSync(new URL('../../scripts/test-all.sh', import.meta.url), 'utf8')

function sourceCheckoutContract(workflow: string): void {
  expect(workflow).toContain('echo "ruby=$(jq -r .revision site/src/data/api/ruby.json)" >> "$GITHUB_OUTPUT"')
  expect(workflow).toContain('echo "lua=$(jq -r .revision site/src/data/api/lua.json)" >> "$GITHUB_OUTPUT"')
  expect(workflow).toContain('repository: libtmux/libtmux-ruby')
  expect(workflow).toContain('repository: libtmux/libtmux-lua')
  expect(workflow).toContain('ref: ${{ steps.integrated-sources.outputs.ruby }}')
  expect(workflow).toContain('ref: ${{ steps.integrated-sources.outputs.lua }}')
  expect(workflow).toContain('path: .port-sources/ruby')
  expect(workflow).toContain('path: .port-sources/lua')
  expect(workflow).toContain('persist-credentials: false')
}

describe('port publisher contract', () => {
  it('reserves every port and requires its exact port/version prefix', () => {
    const reserved = reusable.match(/reserved=\(([^)]+)\)/)?.[1].trim().split(/\s+/)
    expect(reserved).toEqual([...PORTS.map((port) => port.slug), 'manifest', '_shell'])
    expect(reusable).toContain('"$p" != "$PORT_IN/$VERSION_IN"')
    expect(reusable).toContain('^pr-[0-9]+$')
    expect(reusable).toContain('PR previews cannot be defaults')
  })

  it('protects immutable releases before upload and excludes previews from production manifests', () => {
    expect(reusable).toContain("if: inputs.version-kind == 'tag'")
    expect(reusable).toContain('diff -qr dist "$remote"')
    expect(reusable).toContain('immutable tag \'$PREFIX\' already exists with different bytes')
    expect(reusable).toContain("if: inputs.port != '' && inputs.version-kind != 'pr'")
  })

  it('merges successful per-port fragments into both runtime switchers on the next shell publish', () => {
    expect(shell).toContain('Merge successfully published port versions')
    expect(shell).toContain('merge-version-manifests.mjs')
    expect(shell).toContain('manifest/$port.json')
  })

  it('stages source-bound Ruby and Lua guides before the publication audit checks backlinks', () => {
    sourceCheckoutContract(testWorkflow)
    expect(testWorkflow).toContain('node scripts/stage-port-docs.mjs --from-source')
    expect(testWorkflow).toContain('LIBTMUX_DOCS_CHECKOUT_RUBY: ${{ github.workspace }}/.port-sources/ruby')
    expect(testWorkflow).toContain('LIBTMUX_DOCS_CHECKOUT_LUA: ${{ github.workspace }}/.port-sources/lua')
    expect(testWorkflow).toContain('LIBTMUX_DOCS_SKIP_NATIVE_MODEL_PORTS: ruby,lua')
    expect(publicationAudit).toContain('LIBTMUX_DOCS_SKIP_NATIVE_MODEL_PORTS')
    expect(publicationAudit).toContain('--skip-native-model-ports')
  })

  it('can explicitly exclude a raw source guide checkout from native-model freshness', () => {
    const checkout = mkdtempSync(join(tmpdir(), 'libtmux-docs-native-model-'))
    const env = { ...process.env, LIBTMUX_DOCS_CHECKOUT_RUBY: checkout }
    try {
      const unskipped = spawnSync(process.execPath, ['scripts/gen-api-model.mjs', '--port', 'ruby', '--check'], {
        cwd: new URL('../..', import.meta.url), env, encoding: 'utf8',
      })
      expect(unskipped.status).toBe(1)
      expect(unskipped.stderr).toContain('ruby has no native artifact')

      const skipped = spawnSync(process.execPath, [
        'scripts/gen-api-model.mjs', '--port', 'ruby', '--check', '--skip-native-model-ports', 'ruby',
      ], { cwd: new URL('../..', import.meta.url), env, encoding: 'utf8' })
      expect(skipped.status).toBe(0)
      expect(skipped.stdout).toContain('ruby native model freshness skipped')
    } finally {
      rmSync(checkout, { recursive: true, force: true })
    }
  })

  it('assembles previews from latest source-bound Ruby and Lua inputs', () => {
    const preview = shell.slice(shell.indexOf('  build-preview:'), shell.indexOf('  # Same-repo PRs'))
    sourceCheckoutContract(preview)
    expect(preview).toContain('pnpm build:site --versions latest')
    expect(preview).toContain('LIBTMUX_DOCS_CHECKOUT_RUBY: ${{ github.workspace }}/.port-sources/ruby')
    expect(preview).toContain('LIBTMUX_DOCS_CHECKOUT_LUA: ${{ github.workspace }}/.port-sources/lua')
  })
})
