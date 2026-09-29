import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { PORTS } from '../src/lib/ports'

const reusable = readFileSync(new URL('../../.github/workflows/reusable-deploy.yml', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../../.github/workflows/deploy-shell.yml', import.meta.url), 'utf8')
const testWorkflow = readFileSync(new URL('../../.github/workflows/test.yml', import.meta.url), 'utf8')
const publicationAudit = readFileSync(new URL('../../scripts/test-all.sh', import.meta.url), 'utf8')
const publishRoot = readFileSync(new URL('../../scripts/publish-root.sh', import.meta.url), 'utf8')

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

interface ManifestResponse {
  operation: 'get-object' | 'put-object'
  document?: unknown
  etag?: string
  error?: string
  status?: number
}

function publishManifest(responses: ManifestResponse[]) {
  const directory = mkdtempSync(join(tmpdir(), 'libtmux-manifest-publish-'))
  try {
    const calls = join(directory, 'calls.jsonl')
    writeFileSync(calls, '')
    writeFileSync(join(directory, 'responses.json'), JSON.stringify(responses))
    writeFileSync(join(directory, 'aws'), `#!${process.execPath}
const fs = require('node:fs')
const args = process.argv.slice(2)
const calls = fs.readFileSync(process.env.CALLS, 'utf8').trim().split('\\n').filter(Boolean)
const response = JSON.parse(fs.readFileSync(process.env.RESPONSES, 'utf8'))[calls.length]
const call = { args }
if (args[1] === 'put-object') call.document = JSON.parse(fs.readFileSync(args[args.indexOf('--body') + 1], 'utf8'))
fs.appendFileSync(process.env.CALLS, JSON.stringify(call) + '\\n')
if (!response || args[0] !== 's3api' || args[1] !== response.operation) {
  console.error('Unexpected AWS operation: ' + args.join(' '))
  process.exit(90)
}
if (response.error) {
  console.error(response.error)
  process.exit(response.status)
}
if (args[1] === 'get-object') {
  fs.writeFileSync(args.at(-1), JSON.stringify(response.document))
  console.log(response.etag)
}
`, { mode: 0o755 })
    const body = /- name: Upsert manifest\/<port>\.json[\s\S]*?        run: \|\n((?: {10}[^\n]*\n|\n)*)/.exec(reusable)![1]
      .replace(/^ {10}/gm, '')
    const result = spawnSync('bash', ['-c', body], {
      encoding: 'utf8', timeout: 10000, env: {
        ...process.env, PATH: `${directory}:${process.env.PATH}`, RUNNER_TEMP: directory,
        CALLS: calls, RESPONSES: join(directory, 'responses.json'), BUCKET: 'docs-test',
        PORT: 'go', SLUG: 'next', KIND: 'alias', LABEL: 'Next', IS_DEFAULT: 'true', RESOLVES_TO: 'v2',
      },
    })
    expect(result.error, result.stderr).toBeUndefined()
    return {
      ...result,
      calls: readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) as {
        args: string[]
        document?: { ports: Record<string, { slug: string }[]>; defaultVersion: Record<string, string> }
      }[],
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function existingManifest(slugs: string[]) {
  return {
    schema: 1,
    ports: { go: slugs.map((slug) => ({ slug, label: slug, kind: 'tag', supported: true })) },
    defaultVersion: { go: slugs[0] },
  }
}

function manifestError(operation: ManifestResponse['operation'], code: string, status = 254): ManifestResponse {
  const name = operation === 'get-object' ? 'GetObject' : 'PutObject'
  return { operation, error: `An error occurred (${code}) when calling the ${name} operation: request failed`, status }
}

describe('port manifest publication', () => {
  it.each([
    manifestError('get-object', '403'),
    manifestError('get-object', 'SlowDown'),
    { operation: 'get-object', error: 'Could not connect to the endpoint URL: https://docs-test.s3.amazonaws.com', status: 255 },
  ] satisfies ManifestResponse[])('reports a failed read without writing: $error', (response) => {
    const result = publishManifest([response])
    expect(result.status, result.stderr).toBe(response.status)
    expect(result.stderr).toContain('::error::could not read manifest/go.json')
    expect(result.stderr).toContain(response.error)
    expect(result.calls.map(({ args }) => args[1])).toEqual(['get-object'])
  })

  it.each(['404', 'NoSuchKey'])('creates a missing manifest after %s with a conditional first write', (code) => {
    const result = publishManifest([manifestError('get-object', code), { operation: 'put-object' }])
    expect(result.status, result.stderr).toBe(0)
    expect(result.calls[1].args.slice(-2)).toEqual(['--if-none-match', '*'])
    expect(result.calls[1].document).toEqual({
      schema: 1, ports: { go: [{ slug: 'next', label: 'Next', kind: 'alias', supported: true, resolvesTo: 'v2' }] },
      defaultVersion: { go: 'next' },
    })
  })

  it('merges an existing document using the ETag returned with its bytes', () => {
    const result = publishManifest([
      { operation: 'get-object', document: existingManifest(['v1']), etag: '"first"' },
      { operation: 'put-object' },
    ])
    expect(result.status, result.stderr).toBe(0)
    expect(result.calls.map(({ args }) => args[1])).toEqual(['get-object', 'put-object'])
    expect(result.calls[0].args).toContain('ETag')
    expect(result.calls[1].args.slice(-2)).toEqual(['--if-match', '"first"'])
    expect(result.calls[1].document?.ports.go.map(({ slug }) => slug)).toEqual(['v1', 'next'])
  })

  it.each(['existing', 'missing'])('re-reads after a conditional write loses the race on an %s manifest', (mode) => {
    const result = publishManifest([
      mode === 'existing'
        ? { operation: 'get-object', document: existingManifest(['v1']), etag: '"first"' }
        : manifestError('get-object', 'NoSuchKey'),
      manifestError('put-object', 'PreconditionFailed'),
      { operation: 'get-object', document: existingManifest(['v1', 'v2']), etag: '"second"' },
      { operation: 'put-object' },
    ])
    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toContain('manifest write raced on attempt 1')
    expect(result.calls.map(({ args }) => args[1])).toEqual(['get-object', 'put-object', 'get-object', 'put-object'])
    expect(result.calls[3].args.slice(-2)).toEqual(['--if-match', '"second"'])
    expect(result.calls[3].document?.ports.go.map(({ slug }) => slug)).toEqual(['v1', 'v2', 'next'])
  })

  it('reports a failed read during a retry without writing stale content', () => {
    const failure = manifestError('get-object', 'SlowDown')
    const result = publishManifest([
      { operation: 'get-object', document: existingManifest(['v1']), etag: '"first"' },
      manifestError('put-object', '412'), failure,
    ])
    expect(result.status, result.stderr).toBe(failure.status)
    expect(result.stderr).toContain(failure.error)
    expect(result.calls.map(({ args }) => args[1])).toEqual(['get-object', 'put-object', 'get-object'])
  })

  it('reports non-conflict write errors without retrying', () => {
    const failure = manifestError('put-object', 'AccessDenied')
    const result = publishManifest([
      { operation: 'get-object', document: existingManifest(['v1']), etag: '"first"' }, failure,
    ])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(failure.error)
    expect(result.calls).toHaveLength(2)
  })

  it('reports a conflict after three conditional write attempts', () => {
    const responses = [1, 2, 3].flatMap((attempt): ManifestResponse[] => [
      { operation: 'get-object', document: existingManifest([`v${attempt}`]), etag: `"${attempt}"` },
      manifestError('put-object', '412'),
    ])
    const result = publishManifest(responses)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('::error::manifest/go.json still conflicting after 3 attempts')
    expect(result.calls).toHaveLength(6)
  })
})

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
    // Counted in one server-side request. The CLI-paginated form returned a
    // null Contents for any prefix and failed every tag publish.
    const guard = reusable.slice(reusable.indexOf('Protect immutable tag contents'), reusable.indexOf('diff -qr dist'))
    expect(guard).toContain('--max-keys 1')
    expect(guard).toContain("--query 'KeyCount'")
    expect(guard).not.toMatch(/^\s+--max-items/m)
    expect(reusable).toContain('immutable tag \'$PREFIX\' already exists with different bytes')
    expect(reusable).toContain("if: inputs.port != '' && inputs.version-kind != 'pr'")
  })

  it('merges successful per-port fragments into both runtime switchers on the next shell publish', () => {
    expect(shell).toContain('Merge successfully published port versions')
    expect(shell).toContain('merge-version-manifests.mjs')
    expect(shell).toContain('aws s3 sync "s3://$BUCKET/manifest/" published-manifests/')
    // A manifest the shell cannot read fails the deploy. Silencing that copy
    // is how every deploy merged nothing while logging success.
    const merge = shell.slice(
      shell.indexOf('Merge successfully published port versions'),
      shell.indexOf('Sync top-level directories'),
    )
    expect(merge).not.toMatch(/\|\| true|2>\/dev\/null/)
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

describe('shell publish', () => {
  // The headers publish-root.sh sets, and the date they last changed. A file
  // skip-unchanged proves unchanged is not uploaded, so a new header reaches
  // it only because an object older than that date is always re-uploaded.
  // Change a header and this fails until the date moves with it.
  const policy = { since: '2026-09-27', cacheControl: ['public, max-age=0, s-maxage=300'] }

  it('re-uploads every object written before the current header policy', () => {
    const headers = [...new Set([...publishRoot.matchAll(/--cache-control "([^"]+)"/g)].map((match) => match[1]))]
    expect(headers, 'publish-root.sh changed a header: move policy.since and PUBLISH_POLICY_SINCE to today').toEqual(policy.cacheControl)
    expect(shell).toContain(`PUBLISH_POLICY_SINCE: '${policy.since}'`)
  })

  it('skips unchanged files before the syncs that would upload them', () => {
    const skip = shell.indexOf('node skip-unchanged.mjs --dir dist')
    expect(skip).toBeGreaterThan(-1)
    expect(skip).toBeLessThan(shell.indexOf('run: bash publish-root.sh'))
    expect(shell).toContain('cp scripts/skip-unchanged.mjs skip-unchanged.mjs')
  })
})
