import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  RECORD,
  checkoutIdentity,
  digest,
  inventory,
  normalize,
  recordBuild,
  snapshot,
  unpackArchive,
  validateDescriptor,
  verifyBuild,
  workflowIdentity,
  receipt,
} from '../../scripts/publication-provenance.mjs'

const directories: string[] = []
const temporary = () => {
  const directory = mkdtempSync(join(tmpdir(), 'libtmux-provenance-'))
  directories.push(directory)
  return directory
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
const sourceSha = 'a'.repeat(40)
const publisherSha = 'b'.repeat(40)
const inputs = () => ({
  schema: 1,
  port: 'go',
  version: 'v1',
  locale: 'en',
  docs: { repository: 'libtmux/docs', sha: publisherSha, dirty: false },
  sources: [{ product: 'core', repository: 'libtmux/libtmux-go', sha: sourceSha, dirty: false }],
})
const expected = () => ({
  port: 'go',
  version: 'v1',
  locale: 'en',
  prefix: 'en/go/v1',
  publisherRepository: 'libtmux/docs',
  publisherSha,
  sourceSha,
  repository: 'libtmux/libtmux-go',
  name: 'docs-go-v1',
  runId: '42',
  attempt: 2,
})
const descriptor = () => ({
  schema: 1,
  sourceSha,
  artifact: { id: 17, name: 'docs-go-v1', sha256: 'c'.repeat(64) },
  run: { repository: 'libtmux/libtmux-go', id: '42', attempt: 1 },
})
function tree() {
  const root = temporary()
  mkdirSync(join(root, 'api'))
  writeFileSync(
    join(root, 'index.html'),
    '<html><head><script src="/_shell/shell.js"></script></head><body>Go</body></html>',
  )
  writeFileSync(join(root, 'api', 'index.html'), '<!doctype html><meta http-equiv="refresh" content="0;url=../">')
  writeFileSync(join(root, '.build-data'), 'hidden files are covered too')
  recordBuild(root, inputs())
  return root
}
function rewrite(root: string, change: (value: ReturnType<typeof inputs> & { files: unknown[] }) => void) {
  const value = JSON.parse(readFileSync(join(root, RECORD), 'utf8'))
  change(value)
  writeFileSync(join(root, RECORD), JSON.stringify(value))
}
function repository(name: string, source = 'committed input') {
  const directory = temporary()
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init')
  git('remote', 'add', 'origin', `https://github.com/${name}.git`)
  writeFileSync(join(directory, 'source.txt'), source)
  git('add', '.')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.org', 'commit', '-m', 'fixture')
  return { directory, sha: git('rev-parse', 'HEAD') }
}

describe('deterministic build provenance', () => {
  it.each([
    'https://github.com/libtmux/docs.git',
    'git@github.com:libtmux/docs.git',
    'ssh://git@github.com/libtmux/docs.git',
    'git+ssh://git@github.com/libtmux/docs',
  ])('resolves a local GitHub origin %s', (origin) => {
    const checkout = repository('libtmux/docs')
    execFileSync('git', ['-C', checkout.directory, 'remote', 'set-url', 'origin', origin])
    expect(checkoutIdentity(checkout.directory)).toEqual({
      repository: 'libtmux/docs',
      sha: checkout.sha,
      dirty: false,
    })
  })

  it.each([
    'https://github.com.attacker.invalid/libtmux/docs.git',
    'git+ssh://git@elsewhere/libtmux/docs.git',
    'https://github.com/libtmux/docs/extra',
    'https://github.com@elsewhere/libtmux/docs.git',
  ])('rejects a non-GitHub or malformed origin %s', (origin) => {
    const checkout = repository('libtmux/docs')
    execFileSync('git', ['-C', checkout.directory, 'remote', 'set-url', 'origin', origin])
    expect(() => checkoutIdentity(checkout.directory)).toThrow('no GitHub origin')
  })

  it('normalizes, links every HTML page, hashes every regular file, and stays byte-identical on reruns', () => {
    const root = tree()
    const first = readFileSync(join(root, RECORD), 'utf8')
    recordBuild(root, inputs())
    expect(readFileSync(join(root, RECORD), 'utf8')).toBe(first)
    expect(verifyBuild(root, expected()).files.map((file: { path: string }) => file.path)).toEqual([
      '.build-data',
      'api/index.html',
      'index.html',
    ])
    for (const path of ['index.html', 'api/index.html']) {
      expect(readFileSync(join(root, path), 'utf8').match(/data-libtmux-provenance/g)).toHaveLength(1)
      expect(readFileSync(join(root, path), 'utf8')).toContain('/en/go/v1/build-provenance.json')
    }
    expect(readFileSync(join(root, 'api/index.html'), 'utf8').startsWith('<!doctype html><link')).toBe(true)
    expect(readFileSync(join(root, 'index.html'), 'utf8')).toContain('src="/en/_shell/shell.js"')
    expect(receipt(root, descriptor(), expected()).build.sha256).toBe(digest(readFileSync(join(root, RECORD))))
  })

  it.each(['changed', 'missing', 'extra', 'duplicate', 'traversal', 'symlink', 'missing-record'])(
    'rejects %s content',
    (mutation) => {
      const root = tree()
      if (mutation === 'changed') writeFileSync(join(root, 'index.html'), 'other bytes')
      if (mutation === 'missing') rmSync(join(root, 'index.html'))
      if (mutation === 'extra') writeFileSync(join(root, 'extra.html'), 'extra')
      if (mutation === 'duplicate') rewrite(root, (value) => value.files.push(value.files[0]))
      if (mutation === 'traversal')
        rewrite(root, (value) => {
          value.files[0] = { path: '../outside', size: 0, sha256: 'c'.repeat(64) }
        })
      if (mutation === 'symlink') symlinkSync('/etc/passwd', join(root, 'outside'))
      if (mutation === 'missing-record') rmSync(join(root, RECORD))
      expect(() => verifyBuild(root, expected())).toThrow()
    },
  )

  it('rejects a pre-normalization inventory even when it honestly hashes those old bytes', () => {
    const root = tree()
    const path = join(root, 'index.html')
    writeFileSync(path, readFileSync(path, 'utf8').replace('/en/_shell/', '/_shell/'))
    rewrite(root, (value) => {
      value.files = inventory(root)
    })
    expect(() => verifyBuild(root, expected())).toThrow('content inventory differs')
  })

  it('normalization is idempotent for shell and native asset URL forms', () => {
    const root = temporary()
    writeFileSync(join(root, 'native.css'), 'url(/_shell/a.css) url(https://libtmux.org/_shell/b.css)')
    writeFileSync(join(root, 'index.html'), '<script src="http://libtmux.org/_shell/shell.js"></script>')
    normalize(root, 'en')
    const first = inventory(root)
    normalize(root, 'en')
    expect(inventory(root)).toEqual(first)
    expect(readFileSync(join(root, 'native.css'), 'utf8')).toBe('url(/en/_shell/a.css) url(/en/_shell/b.css)')
  })

  it.each(['docs-dirty', 'source-dirty', 'docs-sha', 'source-sha', 'source-repository', 'missing-product'])(
    'rejects %s input claims',
    (mutation) => {
      const root = tree()
      rewrite(root, (value) => {
        if (mutation === 'docs-dirty') value.docs.dirty = true
        if (mutation === 'source-dirty') value.sources[0].dirty = true
        if (mutation === 'docs-sha') value.docs.sha = 'd'.repeat(40)
        if (mutation === 'source-sha') value.sources[0].sha = 'd'.repeat(40)
        if (mutation === 'source-repository') value.sources[0].repository = 'libtmux/libtmux-rs'
        if (mutation === 'missing-product') value.sources = []
      })
      expect(() => verifyBuild(root, expected())).toThrow()
    },
  )

  it.each([
    { port: 'rs' },
    { version: 'v2' },
    { repository: 'libtmux/libtmux-java' },
    { prefix: 'en/rs/v1' },
    { publisherSha: '' },
    { publisherRepository: 'attacker/docs' },
  ])('rejects wrong publisher/destination %j', (changed) => {
    expect(() => verifyBuild(tree(), { ...expected(), ...changed })).toThrow()
  })

  it.each([
    { version: 'v1\nPROVENANCE_REVIEW_MARKER=1' },
    { version: 'v1\n' },
    { version: 'v1/other' },
    { version: 'v1..2' },
    { locale: 'en\nPROVENANCE_REVIEW_MARKER=1' },
    { locale: 'en\n' },
    { locale: '../en' },
  ])('rejects matching malformed build and destination metadata %j', (changed) => {
    const root = tree()
    rewrite(root, (value) => Object.assign(value, changed))
    const destination = { ...expected(), ...changed }
    destination.prefix = `${destination.locale}/${destination.port}/${destination.version}`
    expect(() => verifyBuild(root, destination)).toThrow(changed.version ? 'invalid version' : 'invalid locale')
  })

  it('gets actual Git HEADs and records dirty local inputs before generation', () => {
    const docs = repository('libtmux/docs')
    const source = repository('libtmux/libtmux-go')
    const env = {
      LIBTMUX_DOCS_PORT: 'go',
      LIBTMUX_DOCS_VERSION: 'v1',
      LIBTMUX_DOCS_SOURCE_SHA: source.sha,
      LIBTMUX_DOCS_CHECKOUT_GO: source.directory,
    }
    const clean = snapshot(docs.directory, env)
    expect(clean.docs).toEqual({ repository: 'libtmux/docs', sha: docs.sha, dirty: false })
    expect(clean.sources[0]).toEqual({
      product: 'core',
      repository: 'libtmux/libtmux-go',
      sha: source.sha,
      dirty: false,
    })
    writeFileSync(join(docs.directory, 'source.txt'), 'locally changed API model')
    writeFileSync(join(source.directory, 'new-input.txt'), 'untracked source')
    const dirty = snapshot(docs.directory, env)
    expect(dirty.docs.dirty).toBe(true)
    expect(dirty.sources[0].dirty).toBe(true)
    expect(clean.docs.dirty).toBe(false)
    expect(() => snapshot(docs.directory, { ...env, LIBTMUX_DOCS_SOURCE_SHA: 'f'.repeat(40) })).toThrow(
      'actual checkout HEAD',
    )
  })

  it('records all three Python checkouts at their actual revisions', () => {
    const docs = repository('libtmux/docs')
    const core = repository('tmux-python/libtmux')
    const workspace = repository('tmux-python/tmuxp')
    const mcp = repository('tmux-python/libtmux-mcp')
    writeFileSync(join(mcp.directory, 'source.txt'), 'local companion edit')
    const captured = snapshot(docs.directory, {
      LIBTMUX_DOCS_PORT: 'py',
      LIBTMUX_DOCS_VERSION: 'latest',
      LIBTMUX_DOCS_SOURCE_SHA: core.sha,
      LIBTMUX_DOCS_CHECKOUT_PY: core.directory,
      LIBTMUX_DOCS_WORKSPACE_PY: workspace.directory,
      LIBTMUX_DOCS_MCP_PY: mcp.directory,
    })
    expect(captured.sources).toEqual([
      { product: 'core', repository: 'tmux-python/libtmux', sha: core.sha, dirty: false },
      { product: 'workspace', repository: 'tmux-python/tmuxp', sha: workspace.sha, dirty: false },
      { product: 'mcp', repository: 'tmux-python/libtmux-mcp', sha: mcp.sha, dirty: true },
    ])
  })

  it.each(['ruby', 'lua'])('records %s source and native exporter as separate clean inputs', (port) => {
    const docs = repository('libtmux/docs')
    const name = `libtmux/libtmux-${port}`
    const source = repository(name)
    const generator = repository(name, 'exporter from another revision')
    const env = {
      LIBTMUX_DOCS_PORT: port,
      LIBTMUX_DOCS_VERSION: 'v1',
      LIBTMUX_DOCS_SOURCE_SHA: source.sha,
      [`LIBTMUX_DOCS_CHECKOUT_${port.toUpperCase()}`]: source.directory,
      LIBTMUX_DOCS_GENERATOR_CHECKOUT: generator.directory,
    }
    const captured = snapshot(docs.directory, env)
    expect(captured.sources).toEqual([{ product: 'core', repository: name, sha: source.sha, dirty: false }])
    expect(captured.nativeGenerator).toEqual({ repository: name, sha: generator.sha, dirty: false })
    expect(generator.sha).not.toBe(source.sha)
    const root = tree()
    recordBuild(root, captured)
    const destination = {
      ...expected(),
      port,
      prefix: `en/${port}/v1`,
      repository: name,
      sourceSha: source.sha,
      publisherSha: docs.sha,
    }
    expect(verifyBuild(root, destination).nativeGenerator.sha).toBe(generator.sha)
    writeFileSync(join(generator.directory, 'source.txt'), 'local exporter edit')
    recordBuild(root, snapshot(docs.directory, env))
    expect(() => verifyBuild(root, destination)).toThrow('native generator inputs are dirty')
    expect(
      snapshot(docs.directory, { ...env, LIBTMUX_DOCS_GENERATOR_CHECKOUT: source.directory }).nativeGenerator?.sha,
    ).toBe(source.sha)
  })

  it.each(['missing', 'repository', 'sha', 'dirty', 'missing-dirty'])(
    'rejects %s native exporter metadata',
    (mutation) => {
      const root = tree()
      const record = {
        ...inputs(),
        port: 'ruby',
        sources: [{ product: 'core', repository: 'libtmux/libtmux-ruby', sha: sourceSha, dirty: false }],
        nativeGenerator: { repository: 'libtmux/libtmux-ruby', sha: 'e'.repeat(40), dirty: false },
      }
      if (mutation === 'repository') record.nativeGenerator.repository = 'someone/other-exporter'
      if (mutation === 'sha') record.nativeGenerator.sha = 'master'
      if (mutation === 'dirty') record.nativeGenerator.dirty = true
      if (mutation === 'missing-dirty') Reflect.deleteProperty(record.nativeGenerator, 'dirty')
      if (mutation === 'missing') Reflect.deleteProperty(record, 'nativeGenerator')
      recordBuild(root, record)
      expect(() =>
        verifyBuild(root, { ...expected(), port: 'ruby', prefix: 'en/ruby/v1', repository: 'libtmux/libtmux-ruby' }),
      ).toThrow(/native generator/)
    },
  )

  it('rejects a native exporter claim on a shared-generator port', () => {
    const root = tree()
    recordBuild(root, {
      ...inputs(),
      nativeGenerator: { repository: 'libtmux/libtmux-go', sha: sourceSha, dirty: false },
    })
    expect(() => verifyBuild(root, expected())).toThrow('unexpected native generator')
  })

  it('rechecks the native exporter HEAD when consuming the captured inputs', () => {
    const docs = repository('libtmux/docs')
    const source = repository('libtmux/libtmux-lua')
    const generator = repository('libtmux/libtmux-lua', 'separate native exporter')
    const env = {
      LIBTMUX_DOCS_PORT: 'lua',
      LIBTMUX_DOCS_VERSION: 'v1',
      LIBTMUX_DOCS_SOURCE_SHA: source.sha,
      LIBTMUX_DOCS_CHECKOUT_LUA: source.directory,
      LIBTMUX_DOCS_GENERATOR_CHECKOUT: generator.directory,
    }
    const file = join(temporary(), 'before-native-generator.json')
    writeFileSync(file, JSON.stringify(snapshot(docs.directory, env)))
    writeFileSync(join(generator.directory, 'generated-output.json'), '{}')
    expect(snapshot(docs.directory, { ...env, LIBTMUX_DOCS_INPUT_SNAPSHOT: file }).nativeGenerator?.dirty).toBe(false)
    writeFileSync(join(generator.directory, 'source.txt'), 'new committed native exporter')
    execFileSync('git', [
      '-C',
      generator.directory,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.org',
      'commit',
      '-am',
      'change exporter',
    ])
    expect(() => snapshot(docs.directory, { ...env, LIBTMUX_DOCS_INPUT_SNAPSHOT: file })).toThrow(
      'no longer matches checkout revisions',
    )
    expect(() => snapshot(docs.directory, { ...env, LIBTMUX_DOCS_GENERATOR_CHECKOUT: docs.directory })).toThrow(
      'native generator repository',
    )
  })

  it.each(['ruby', 'lua'])('can build an explicitly selected %s fork but rejects its publication', (port) => {
    const docs = repository('libtmux/docs')
    const source = repository(`contributor/libtmux-${port}`)
    const generator = repository(`libtmux/libtmux-${port}`)
    const env = {
      LIBTMUX_DOCS_PORT: port,
      LIBTMUX_DOCS_VERSION: 'v1',
      LIBTMUX_DOCS_SOURCE_SHA: source.sha,
      [`LIBTMUX_DOCS_CHECKOUT_${port.toUpperCase()}`]: source.directory,
      LIBTMUX_DOCS_GENERATOR_CHECKOUT: generator.directory,
    }
    expect(() => snapshot(docs.directory, env)).toThrow('source repository must be libtmux/')
    const captured = snapshot(docs.directory, { ...env, LIBTMUX_DOCS_SOURCE_REPOSITORY: `contributor/libtmux-${port}` })
    const root = tree()
    recordBuild(root, captured)
    const destination = {
      ...expected(),
      port,
      prefix: `en/${port}/v1`,
      repository: `libtmux/libtmux-${port}`,
      publisherSha: docs.sha,
      sourceSha: source.sha,
    }
    expect(() => verifyBuild(root, destination)).toThrow('invalid source repository/SHA')
    expect(() => verifyBuild(root, { ...destination, repository: `contributor/libtmux-${port}` })).toThrow(
      'does not own this port',
    )
  })

  it('allows a wrapper only through its owning library repository', () => {
    const root = tree()
    const wrapper = {
      ...inputs(),
      port: 'kotlin',
      sources: [{ product: 'core', repository: 'libtmux/libtmux-java', sha: sourceSha, dirty: false }],
    }
    recordBuild(root, wrapper)
    const destination = { ...expected(), port: 'kotlin', prefix: 'en/kotlin/v1', repository: 'libtmux/libtmux-java' }
    expect(verifyBuild(root, destination).port).toBe('kotlin')
    expect(() => verifyBuild(root, { ...destination, repository: 'libtmux/libtmux-go' })).toThrow(
      'does not own this port',
    )
  })

  it('rechecks every HEAD when consuming a snapshot taken before native generation', () => {
    const docs = repository('libtmux/docs')
    const source = repository('libtmux/libtmux-go')
    const env = {
      LIBTMUX_DOCS_PORT: 'go',
      LIBTMUX_DOCS_VERSION: 'v1',
      LIBTMUX_DOCS_SOURCE_SHA: source.sha,
      LIBTMUX_DOCS_CHECKOUT_GO: source.directory,
    }
    const file = join(temporary(), 'before-generators.json')
    writeFileSync(file, JSON.stringify(snapshot(docs.directory, env)))
    writeFileSync(join(source.directory, 'generated.json'), 'native output')
    expect(snapshot(docs.directory, { ...env, LIBTMUX_DOCS_INPUT_SNAPSHOT: file }).sources[0].dirty).toBe(false)
    const captured = JSON.parse(readFileSync(file, 'utf8'))
    captured.sources[0].sha = 'd'.repeat(40)
    writeFileSync(file, JSON.stringify(captured))
    expect(() => snapshot(docs.directory, { ...env, LIBTMUX_DOCS_INPUT_SNAPSHOT: file })).toThrow(
      'no longer matches checkout revisions',
    )
  })

  it('fails clearly when reusable workflow identity contexts are unavailable', () => {
    expect(() => workflowIdentity('', '')).toThrow('GitHub Cloud')
    expect(() => workflowIdentity('libtmux/docs', 'main')).toThrow('full commit SHA')
  })
})

describe('artifact identity and safe archive extraction', () => {
  it('accepts a completed builder attempt when only publishing is rerun', () => {
    expect(validateDescriptor(descriptor(), expected()).run.attempt).toBe(1)
  })
  it.each(['name', 'id', 'digest', 'repository', 'run', 'future-attempt', 'source', 'schema'])(
    'rejects a wrong %s descriptor',
    (mutation) => {
      const value = descriptor()
      if (mutation === 'name') value.artifact.name = 'docs-rs-v1'
      if (mutation === 'id') value.artifact.id = 0
      if (mutation === 'digest') value.artifact.sha256 = 'bad'
      if (mutation === 'repository') value.run.repository = 'libtmux/libtmux-rs'
      if (mutation === 'run') value.run.id = '43'
      if (mutation === 'future-attempt') value.run.attempt = 3
      if (mutation === 'source') value.sourceSha = 'main'
      if (mutation === 'schema') value.schema = 2
      expect(() => validateDescriptor(value, expected())).toThrow()
    },
  )
  function archive(entry = 'index.html', mode = 'file') {
    const directory = temporary()
    const file = join(directory, 'download.zip')
    execFileSync(
      'python3',
      [
        '-c',
        `import sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'w') as archive:
    info = zipfile.ZipInfo(sys.argv[2])
    if sys.argv[3] == 'symlink': info.external_attr = 0o120777 << 16
    archive.writestr(info, 'hello')
    if sys.argv[3] == 'duplicate': archive.writestr(info, 'other')
`,
        file,
        entry,
        mode,
      ],
      { stdio: 'pipe' },
    )
    return {
      directory,
      value: { ...descriptor(), artifact: { ...descriptor().artifact, sha256: digest(readFileSync(file)) } },
    }
  }
  it('checks the actual ZIP digest against the upload output before extraction', () => {
    const { directory, value } = archive()
    const out = join(temporary(), 'dist')
    unpackArchive(directory, value, out)
    expect(readFileSync(join(out, 'index.html'), 'utf8')).toBe('hello')
    expect(() => unpackArchive(directory, descriptor(), join(temporary(), 'bad'))).toThrow('archive SHA256 differs')
  })
  it.each([
    ['../outside', 'file'],
    ['/absolute', 'file'],
    ['link', 'symlink'],
    ['same', 'duplicate'],
  ])('rejects unsafe archive %s (%s)', (entry, mode) => {
    const { directory, value } = archive(entry, mode)
    expect(() => unpackArchive(directory, value, join(temporary(), 'dist'))).toThrow()
  })
})
