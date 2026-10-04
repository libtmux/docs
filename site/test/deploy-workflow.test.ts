import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { API_MODEL_PORTS, PORTS } from '../src/lib/ports'

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

const publication = {
  build: { url: '/en/go/next/build-provenance.json', sha256: 'a'.repeat(64) },
  artifact: { id: 17, name: 'docs-go-next', sha256: 'b'.repeat(64) },
  run: { url: 'https://github.com/libtmux/libtmux-go/actions/runs/42', attempt: 1 },
  publisher: { repository: 'libtmux/docs', sha: 'c'.repeat(40) },
  destination: { prefix: 'en/go/next/', url: 'https://libtmux.org/en/go/next/' },
}

function publishManifest(responses: ManifestResponse[], env: Record<string, string> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'libtmux-manifest-publish-'))
  try {
    const calls = join(directory, 'calls.jsonl')
    writeFileSync(calls, '')
    writeFileSync(join(directory, 'publication-receipt.json'), JSON.stringify(publication))
    writeFileSync(join(directory, 'summary'), '')
    writeFileSync(join(directory, 'responses.json'), JSON.stringify(responses))
    writeFileSync(
      join(directory, 'aws'),
      `#!${process.execPath}
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
`,
      { mode: 0o755 },
    )
    const body = /- name: Upsert manifest\/<port>\.json[\s\S]*?        run: \|\n((?: {10}[^\n]*\n|\n)*)/
      .exec(reusable)![1]
      .replace(/^ {10}/gm, '')
    const result = spawnSync('bash', ['-c', body], {
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        RUNNER_TEMP: directory,
        CALLS: calls,
        RESPONSES: join(directory, 'responses.json'),
        BUCKET: 'docs-test',
        PORT: 'go',
        SLUG: 'next',
        KIND: 'alias',
        LABEL: 'Next',
        IS_DEFAULT: 'true',
        RESOLVES_TO: 'v2',
        GITHUB_STEP_SUMMARY: join(directory, 'summary'),
        PREFIX: 'en/go/next',
        ...env,
      },
    })
    expect(result.error, result.stderr).toBeUndefined()
    return {
      ...result,
      summary: readFileSync(join(directory, 'summary'), 'utf8'),
      calls: readFileSync(calls, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line)) as {
        args: string[]
        document?: {
          ports: Record<string, { slug: string; publication?: typeof publication & { operation: string } }[]>
          defaultVersion: Record<string, string>
        }
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

function manifestError(
  operation: ManifestResponse['operation'],
  code: string,
  status = 254,
  prefix = '',
): ManifestResponse {
  const name = operation === 'get-object' ? 'GetObject' : 'PutObject'
  return {
    operation,
    error: `${prefix}An error occurred (${code}) when calling the ${name} operation: request failed`,
    status,
  }
}

describe('port manifest publication', () => {
  it.each([
    manifestError('get-object', '403'),
    manifestError('get-object', 'SlowDown'),
    manifestError('get-object', '403', 254, 'aws: [ERROR]: '),
    manifestError('get-object', 'AccessDenied', 254, 'aws: [ERROR]: '),
    manifestError('get-object', 'SlowDown', 254, 'aws: [ERROR]: '),
    manifestError('get-object', 'NoSuchKey', 254, 'Unexpected error: '),
    {
      operation: 'get-object',
      error: 'Could not connect to the endpoint URL: https://docs-test.s3.amazonaws.com',
      status: 255,
    },
  ] satisfies ManifestResponse[])('reports a failed read without writing: $error', (response) => {
    const result = publishManifest([response])
    expect(result.status, result.stderr).toBe(response.status)
    expect(result.stderr).toContain('::error::could not read manifest/go.json')
    expect(result.stderr).toContain(response.error)
    expect(result.calls.map(({ args }) => args[1])).toEqual(['get-object'])
  })

  it.each(['404', 'NoSuchKey'].flatMap((code) => ['', 'aws: [ERROR]: '].map((prefix) => ({ code, prefix }))))(
    'creates a missing manifest after $prefix$code with a conditional first write',
    ({ code, prefix }) => {
      const result = publishManifest([manifestError('get-object', code, 254, prefix), { operation: 'put-object' }])
      expect(result.status, result.stderr).toBe(0)
      expect(result.calls[1].args.slice(-2)).toEqual(['--if-none-match', '*'])
      expect(result.calls[1].document).toEqual({
        schema: 1,
        ports: {
          go: [
            {
              slug: 'next',
              label: 'Next',
              kind: 'alias',
              supported: true,
              resolvesTo: 'v2',
              publication: { ...publication, operation: 'published' },
            },
          ],
        },
        defaultVersion: { go: 'next' },
      })
    },
  )

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
      manifestError('put-object', '412'),
      failure,
    ])
    expect(result.status, result.stderr).toBe(failure.status)
    expect(result.stderr).toContain(failure.error)
    expect(result.calls.map(({ args }) => args[1])).toEqual(['get-object', 'put-object', 'get-object'])
  })

  it('reports non-conflict write errors without retrying', () => {
    const failure = manifestError('put-object', 'AccessDenied')
    const result = publishManifest([
      { operation: 'get-object', document: existingManifest(['v1']), etag: '"first"' },
      failure,
    ])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(failure.error)
    expect(result.calls).toHaveLength(2)
    expect(result.summary).toBe('')
  })

  it('preserves the original receipt only for identical immutable bytes', () => {
    const original = { ...publication, operation: 'published', artifact: { ...publication.artifact, id: 9 } }
    const document = {
      schema: 1,
      ports: { go: [{ slug: 'next', publication: original }] },
      defaultVersion: { go: 'next' },
    }
    const responses: ManifestResponse[] = [
      { operation: 'get-object', document, etag: '"old"' },
      { operation: 'put-object' },
    ]
    const immutable = publishManifest(responses, { KIND: 'tag', SKIP_SYNC: 'true' })
    expect(immutable.status, immutable.stderr).toBe(0)
    expect(immutable.calls[1].document?.ports.go[0].publication).toEqual(original)
    expect(immutable.summary).toContain('original receipt was preserved')
    const mutable = publishManifest(responses)
    expect(mutable.status, mutable.stderr).toBe(0)
    expect(mutable.calls[1].document?.ports.go[0].publication?.artifact.id).toBe(17)
  })

  it('describes legacy immutable bytes without a receipt as verified existing', () => {
    const result = publishManifest(
      [{ operation: 'get-object', document: existingManifest(['next']), etag: '"old"' }, { operation: 'put-object' }],
      { KIND: 'tag', SKIP_SYNC: 'true' },
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.calls[1].document?.ports.go[0].publication?.operation).toBe('verified-existing')
  })

  it('fails without a successful receipt if an immutable manifest disagrees with the verified build', () => {
    const document = {
      schema: 1,
      ports: {
        go: [
          { slug: 'next', publication: { ...publication, build: { ...publication.build, sha256: 'd'.repeat(64) } } },
        ],
      },
      defaultVersion: {},
    }
    const result = publishManifest([{ operation: 'get-object', document, etag: '"old"' }], {
      KIND: 'tag',
      SKIP_SYNC: 'true',
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('immutable publication receipt disagrees')
    expect(result.calls).toHaveLength(1)
    expect(result.summary).toBe('')
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

describe('immutable byte guard', () => {
  it.each(['identical', 'changed', 'legacy-no-record'])('handles %s remote bytes without rewriting them', (mode) => {
    const directory = mkdtempSync(join(tmpdir(), 'libtmux-immutable-'))
    try {
      mkdirSync(join(directory, 'dist'))
      mkdirSync(join(directory, 'remote'))
      for (const folder of ['dist', 'remote']) {
        writeFileSync(
          join(directory, folder, 'index.html'),
          folder === 'remote' && mode === 'changed' ? 'other bytes' : 'same page',
        )
        if (folder === 'dist' || mode !== 'legacy-no-record')
          writeFileSync(join(directory, folder, 'build-provenance.json'), '{}')
      }
      writeFileSync(join(directory, 'env'), '')
      writeFileSync(
        join(directory, 'aws'),
        `#!${process.execPath}
const fs = require('node:fs')
const args = process.argv.slice(2)
if (args[0] === 's3api' && args[1] === 'list-objects-v2') console.log('1')
else if (args[0] === 's3' && args[1] === 'sync' && args[2] === 's3://docs-test/en/go/v1/') fs.cpSync(process.env.REMOTE, args[3], { recursive: true })
else process.exit(90)
`,
        { mode: 0o755 },
      )
      const body = /- name: Protect immutable tag contents[\s\S]*?        run: \|\n((?: {10}[^\n]*\n|\n)*)/
        .exec(reusable)![1]
        .replace(/^ {10}/gm, '')
      const result = spawnSync('bash', ['-c', body], {
        cwd: directory,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          RUNNER_TEMP: directory,
          BUCKET: 'docs-test',
          PREFIX: 'en/go/v1',
          GITHUB_ENV: join(directory, 'env'),
          REMOTE: join(directory, 'remote'),
        },
      })
      expect(result.status, result.stderr).toBe(mode === 'identical' ? 0 : 1)
      expect(readFileSync(join(directory, 'env'), 'utf8')).toBe(mode === 'identical' ? 'SKIP_SYNC=true\n' : '')
      if (mode !== 'identical') expect(result.stderr).toContain('already exists with different bytes')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('port publisher contract', () => {
  function validatePrefix(repository: string, port = '', prefix = 'pr-42', env: Record<string, string> = {}) {
    const directory = mkdtempSync(join(tmpdir(), 'libtmux-publish-prefix-'))
    try {
      const environment = join(directory, 'env')
      writeFileSync(environment, '')
      const body = /- name: Validate path-prefix[\s\S]*?        run: \|\n((?: {10}[^\n]*\n|\n)*)/
        .exec(reusable)![1]
        .replace(/^ {10}/gm, '')
      const result = spawnSync('bash', ['-c', body], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_REPOSITORY: repository,
          GITHUB_ENV: environment,
          PREFIX_IN: prefix,
          PORT_IN: port,
          VERSION_IN: 'pr-42',
          KIND_IN: 'pr',
          DEFAULT_IN: 'false',
          LIBTMUX_DOCS_LOCALE: 'en',
          ...env,
        },
      })
      return { ...result, environment: readFileSync(environment, 'utf8') }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }

  it.each([...new Set(PORTS.map((port) => port.repo)), 'unknown/docs', ''])(
    'rejects an empty port from %s before selecting an artifact or AWS credentials',
    (repository) => {
      const result = validatePrefix(repository)
      expect(result.status, result.stderr).toBe(1)
      expect(result.stderr).toContain('must supply a port and its publication provenance')
      expect(result.environment).toBe('')
      expect(reusable.indexOf('Validate path-prefix')).toBeLessThan(reusable.indexOf('uses: actions/download-artifact'))
      expect(reusable.indexOf('Validate path-prefix')).toBeLessThan(
        reusable.indexOf('uses: aws-actions/configure-aws-credentials'),
      )
    },
  )

  it.each(['libtmux/docs', 'tony/libtmux-docs'])('retains the shared preview contract for %s', (repository) => {
    const result = validatePrefix(repository)
    expect(result.status, result.stderr).toBe(0)
    expect(result.environment).toBe('PREFIX=pr-42\n')
  })

  it('passes a qualified port through to its required provenance validation', () => {
    const result = validatePrefix('libtmux/libtmux-go', 'go', 'go/pr-42')
    expect(result.status, result.stderr).toBe(0)
    expect(result.environment).toBe('PREFIX=en/go/pr-42\n')
  })

  it.each(['v1\nPROVENANCE_REVIEW_MARKER=1', 'v1\rMARKER=1', 'v1\n', 'v1/other', 'v1..2', 'v1+build'])(
    'rejects malformed version %j without writing environment bytes',
    (version) => {
      const result = validatePrefix('libtmux/libtmux-go', 'go', `go/${version}`, {
        VERSION_IN: version,
        KIND_IN: 'tag',
      })
      expect(result.status, result.stderr).toBe(1)
      expect(result.environment).toBe('')
    },
  )

  it.each(['en\nPROVENANCE_REVIEW_MARKER=1', 'en\n', '../en', 'en/py', 'english'])(
    'rejects malformed locale %j without writing environment bytes',
    (locale) => {
      const result = validatePrefix('libtmux/libtmux-go', 'go', 'go/pr-42', { LIBTMUX_DOCS_LOCALE: locale })
      expect(result.status, result.stderr).toBe(1)
      expect(result.stderr).toContain('invalid publication locale')
      expect(result.environment).toBe('')
    },
  )

  it('reserves every port and requires its exact port/version prefix', () => {
    const reserved = reusable
      .match(/reserved=\(([^)]+)\)/)?.[1]
      .trim()
      .split(/\s+/)
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
    expect(reusable).toContain("immutable tag '$PREFIX' already exists with different bytes")
    expect(reusable).toContain("if: inputs.port != '' && inputs.version-kind != 'pr'")
  })

  it('validates a specific artifact before credentials and only records a receipt after a successful sync', () => {
    const verify = reusable.indexOf('Verify artifact and build provenance')
    const credentials = reusable.indexOf('uses: aws-actions/configure-aws-credentials')
    const sync = reusable.indexOf("Sync to this call's own prefix")
    const manifest = reusable.indexOf('Upsert manifest/<port>.json')
    expect(verify).toBeGreaterThan(0)
    expect(verify).toBeLessThan(credentials)
    expect(credentials).toBeLessThan(sync)
    expect(sync).toBeLessThan(manifest)
    expect(reusable.slice(sync)).not.toMatch(/continue-on-error|if:.*always\(\)/)
    expect(reusable).toContain('artifact-ids: ${{ steps.descriptor.outputs.artifact-id }}')
    expect(reusable).toContain('skip-decompress: true')
    expect(reusable).toContain('digest-mismatch: error')
    expect(reusable).not.toContain('actions: read')
    expect(reusable).toContain('ref: ${{ job.workflow_sha }}')
    expect(reusable).toContain('"$WORKFLOW_SHA" =~ ^[0-9a-f]{40}$')
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
        cwd: new URL('../..', import.meta.url),
        env,
        encoding: 'utf8',
      })
      expect(unskipped.status).toBe(1)
      expect(unskipped.stderr).toContain('ruby has no native artifact')

      const skipped = spawnSync(
        process.execPath,
        ['scripts/gen-api-model.mjs', '--port', 'ruby', '--check', '--skip-native-model-ports', 'ruby'],
        { cwd: new URL('../..', import.meta.url), env, encoding: 'utf8' },
      )
      expect(skipped.status).toBe(0)
      expect(skipped.stdout).toContain('ruby native model freshness skipped')
    } finally {
      rmSync(checkout, { recursive: true, force: true })
    }
  })

  it('assembles previews from latest source-bound Ruby and Lua inputs', () => {
    sourceCheckoutContract(testWorkflow)
    expect(testWorkflow).toContain('pnpm test:publication --preview "$PREVIEW_PREFIX"')
    expect(publicationAudit).toContain('./scripts/build-site.sh --versions latest,stable')
    expect(publicationAudit.indexOf("step 'unit tests'")).toBeLessThan(publicationAudit.indexOf("step 'build'"))
    expect(shell).not.toMatch(/^  (pull_request|build-preview|publish-preview|check-publish-preview):/m)
  })

  it('publishes only the same-run artifact that passed both the audit and publisher dry-run', () => {
    const audit = testWorkflow.slice(testWorkflow.indexOf('  test:'), testWorkflow.indexOf('  check-publish-preview:'))
    const check = testWorkflow.slice(
      testWorkflow.indexOf('  check-publish-preview:'),
      testWorkflow.indexOf('  publish-preview:'),
    )
    const publish = testWorkflow.slice(testWorkflow.indexOf('  publish-preview:'))
    expect(audit.indexOf('name: test-all')).toBeLessThan(audit.indexOf('name: Upload audited preview'))
    expect(audit).toContain('preview-artifact-id: ${{ steps.preview-artifact.outputs.artifact-id }}')
    expect(check).toContain('needs: test')
    expect(check).toContain('artifact-ids: ${{ needs.test.outputs.preview-artifact-id }}')
    expect(check).toContain('digest-mismatch: error')
    expect(publish).toContain('needs: [test, check-publish-preview]')
    expect(publish).toContain('artifact-id: ${{ needs.test.outputs.preview-artifact-id }}')
    expect(publish).toContain('github.event.pull_request.head.repo.full_name == github.repository')
    expect(publish).toContain('environment: docs-preview')
    expect(testWorkflow).toContain("format('deploy-shell-pr-{0}', github.event.pull_request.number)")
    expect((audit + check).replace(/^\s*#.*$/gm, '')).not.toMatch(
      /id-token:|secrets\.|continue-on-error|always\(\)|run-id:|github-token:/,
    )
    expect(testWorkflow + shell).not.toMatch(/pull_request_target:|workflow_run:/)
    expect(publish).not.toMatch(/continue-on-error|always\(\)/)
    const download = reusable.slice(
      reusable.indexOf('      # Without github-token'),
      reusable.indexOf("      - if: inputs.port == '' && inputs.version-kind != 'pr'"),
    )
    expect(download).toContain('artifact-ids: ${{ inputs.artifact-id }}')
    expect(download).toContain('digest-mismatch: error')
    expect(download).not.toMatch(/^\s*(name|run-id|github-token|repository):/m)
    expect(reusable.indexOf('Validate preview artifact identity')).toBeLessThan(
      reusable.indexOf('uses: aws-actions/configure-aws-credentials'),
    )
  })

  it.each(['', '0', '-1', '12,13', '12other', '12\n', '12\nMARKER=1', '17'])(
    'validates one immutable preview artifact ID: %j',
    (id) => {
      const body = /- name: Validate preview artifact identity[\s\S]*?        run: \|\n((?: {10}[^\n]*\n|\n)*)/
        .exec(reusable)![1]
        .replace(/^ {10}/gm, '')
      const result = spawnSync('bash', ['-c', body], { encoding: 'utf8', env: { ...process.env, ARTIFACT_ID: id } })
      expect(result.status).toBe(id === '17' ? 0 : 1)
      if (id !== '17') expect(result.stderr).toContain('requires one audited artifact ID from this run')
    },
  )

  it('retains fresh production root renders before output checks on preview audits', () => {
    expect(publicationAudit).toContain("step 'production root renders'")
    expect(publicationAudit).toContain('LIBTMUX_DOCS_VERSION_KIND=trunk LIBTMUX_DOCS_IS_DEFAULT=true')
    expect(publicationAudit).toContain('--outDir "$LIBTMUX_DOCS_TEST_PRODUCTION_SITE/$locale"')
    expect(publicationAudit.indexOf("step 'production root renders'")).toBeLessThan(
      publicationAudit.indexOf("step 'output tests'"),
    )
    expect(publicationAudit).toContain("echo 'missing production root render'")
  })
})

describe('publication URL audits', () => {
  it.each([
    ['', '', false, true],
    ['/pr-49', '/pr-49', false, true],
    ['/pr-49', '', false, false],
    ['/pr-49', '/pr-50', false, false],
    ['/pr-49', '/pr-49', true, false],
  ] as const)(
    'checks Core Library targets within %j with href prefix %j and missing target %j',
    (prefix, hrefPrefix, missing, valid) => {
      const directory = mkdtempSync(join(tmpdir(), 'libtmux-sidebar-prefix-'))
      try {
        for (const { slug } of API_MODEL_PORTS) {
          const page = join(directory, slug, 'latest/concepts')
          const reference = join(directory, slug, 'latest/reference')
          mkdirSync(page, { recursive: true })
          mkdirSync(reference, { recursive: true })
          if (!missing || slug !== 'rs') writeFileSync(join(reference, 'index.html'), 'reference')
          const host = ({ rs: 'docs.rs', go: 'pkg.go.dev', java: 'javadoc.io' } as Record<string, string>)[slug]
          const links =
            `<div class="surface-options"><a href="${hrefPrefix}/en/${slug}/latest/">Home</a><a href="${hrefPrefix}/en/${slug}/latest/reference/">API Reference</a></div>` +
            '<div class="surface-alternatives">' +
            (host ? `<a href="https://${host}/" target="_blank" rel="noopener noreferrer">${host}</a>` : '') +
            (slug === 'py' ? `<a href="${hrefPrefix}/en/py/latest/api/">Upstream reference</a>` : '') +
            '</div>'
          writeFileSync(
            join(page, 'index.html'),
            `<details data-surface-picker><details data-surface-group><summary><strong>Core Library</strong></summary>${links}</details></details>` +
              '<nav class="sidebar-nav"><a href="#concept">Concepts</a></nav>'.repeat(2),
          )
        }
        const result = spawnSync(process.execPath, ['scripts/check-sidebar-refs.mjs', directory], {
          cwd: new URL('../..', import.meta.url),
          encoding: 'utf8',
          env: { ...process.env, LIBTMUX_DOCS_LOCALES_ROOT: prefix, LIBTMUX_DOCS_LOCALE: 'en' },
        })
        expect(result.status, result.stderr).toBe(valid ? 0 : 1)
        if (!valid) expect(result.stderr).toContain('is linked but not built')
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    },
  )

  it.each([
    ['', '/en/py/latest/reference/server/', true],
    ['/pr-49', '/pr-49/en/py/latest/reference/server/', true],
    ['/pr-49', '/en/py/latest/reference/server/', false],
    ['/pr-49', '/pr-50/en/py/latest/reference/server/', false],
  ] as const)('checks the declared canonical within %j', (prefix, canonical, valid) => {
    const directory = mkdtempSync(join(tmpdir(), 'libtmux-canonical-prefix-'))
    try {
      const page = join(directory, 'py/latest/reference/server')
      mkdirSync(page, { recursive: true })
      writeFileSync(join(page, 'index.html'), `<link rel="canonical" href="https://libtmux.org${canonical}">`)
      const result = spawnSync(process.execPath, ['scripts/check-canonicals.mjs', directory], {
        cwd: new URL('../..', import.meta.url),
        encoding: 'utf8',
        env: { ...process.env, LIBTMUX_DOCS_LOCALES_ROOT: prefix, LIBTMUX_DOCS_LOCALE: 'en' },
      })
      expect(result.status, result.stderr).toBe(valid ? 0 : 1)
      if (!valid) expect(result.stderr).toContain('canonicalise somewhere other than themselves')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
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
    expect(headers, 'publish-root.sh changed a header: move policy.since and PUBLISH_POLICY_SINCE to today').toEqual(
      policy.cacheControl,
    )
    expect(shell).toContain(`PUBLISH_POLICY_SINCE: '${policy.since}'`)
  })

  it('skips unchanged files before the syncs that would upload them', () => {
    const skip = shell.indexOf('node skip-unchanged.mjs --dir dist')
    expect(skip).toBeGreaterThan(-1)
    expect(skip).toBeLessThan(shell.indexOf('run: bash publish-root.sh'))
    expect(shell).toContain('cp scripts/skip-unchanged.mjs skip-unchanged.mjs')
  })
})
