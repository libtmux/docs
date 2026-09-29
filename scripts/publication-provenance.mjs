#!/usr/bin/env node
/** Deterministic build inputs and bytes; run-specific artifact identity stays outside the tree. */
import { appendFileSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORT_BY_SLUG } from '../site/src/lib/ports.ts'

export const RECORD = 'build-provenance.json'
const SHA = /^[0-9a-f]{40}$/
const DIGEST = /^[0-9a-f]{64}$/
const segment = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const fail = (message) => { throw new Error(`publication-provenance: ${message}`) }
const check = (condition, message) => { if (!condition) fail(message) }
const json = (file) => JSON.parse(readFileSync(file, 'utf8'))
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const write = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
const git = (directory, ...args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim()

function validateRoute(version, locale) {
  check(typeof version === 'string' && segment.test(version) && !/[\r\n]/.test(version) && !version.includes('..'), 'invalid version')
  check(typeof locale === 'string' && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(locale) && !/[\r\n]/.test(locale), 'invalid locale')
}

export function workflowIdentity(repository, sha) {
  check(repository === 'libtmux/docs' && SHA.test(sha ?? ''),
    'GitHub Cloud job.workflow_repository/job.workflow_sha must identify libtmux/docs at a full commit SHA')
  return { repository, sha }
}

export function checkoutIdentity(directory) {
  const origin = git(directory, 'remote', 'get-url', 'origin')
  const repository = /^(?:https:\/\/github\.com\/|git@github\.com:|(?:git\+)?ssh:\/\/git@github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/.exec(origin)?.[1]
  check(repository, `checkout has no GitHub origin: ${directory}`)
  const sha = git(directory, 'rev-parse', 'HEAD')
  check(SHA.test(sha), 'checkout HEAD must be a full SHA')
  return { repository, sha, dirty: git(directory, 'status', '--porcelain', '--untracked-files=normal') !== '' }
}

export function snapshot(docsRoot, env = process.env) {
  const port = PORT_BY_SLUG[env.LIBTMUX_DOCS_PORT]
  check(port, 'unknown source port')
  const locale = env.LIBTMUX_DOCS_LOCALE || 'en'
  validateRoute(env.LIBTMUX_DOCS_VERSION, locale)
  const core = checkoutIdentity(env[`LIBTMUX_DOCS_CHECKOUT_${port.slug.toUpperCase()}`])
  check(core.repository === port.repo, `source repository must be ${port.repo}`)
  check(core.sha === env.LIBTMUX_DOCS_SOURCE_SHA, 'source SHA differs from actual checkout HEAD')
  const sources = [{ product: 'core', ...core }]
  if (port.slug === 'py') {
    for (const [product, variable, fallback, repository] of [
      ['workspace', 'LIBTMUX_DOCS_WORKSPACE_PY', 'work/python/tmuxp', 'tmux-python/tmuxp'],
      ['mcp', 'LIBTMUX_DOCS_MCP_PY', 'work/python/libtmux-mcp', 'tmux-python/libtmux-mcp'],
    ]) {
      const input = checkoutIdentity(env[variable] || join(homedir(), fallback))
      check(input.repository === repository, `source repository must be ${repository}`)
      sources.push({ product, ...input })
    }
  }
  const docs = checkoutIdentity(docsRoot)
  check(docs.repository === 'libtmux/docs', 'docs checkout must belong to libtmux/docs')
  const current = { schema: 1, port: port.slug, version: env.LIBTMUX_DOCS_VERSION, locale, docs, sources }
  if (!env.LIBTMUX_DOCS_INPUT_SNAPSHOT) return current
  const captured = json(env.LIBTMUX_DOCS_INPUT_SNAPSHOT)
  // The shared builder captures inputs before native generators emit files
  // such as Swift symbolgraph/. Their output must not masquerade as a source
  // edit. Recheck every actual HEAD when assembly consumes that snapshot.
  const revisions = (value) => ({ ...value,
    docs: { ...value.docs, dirty: undefined },
    sources: value.sources.map((source) => ({ ...source, dirty: undefined })),
  })
  check(JSON.stringify(revisions(captured)) === JSON.stringify(revisions(current)), 'input snapshot no longer matches checkout revisions')
  check(typeof captured.docs.dirty === 'boolean' && captured.sources.every((source) => typeof source.dirty === 'boolean'), 'input snapshot has no dirty state')
  return captured
}

function paths(root, prefix = '') {
  const result = []
  for (const name of readdirSync(join(root, prefix)).sort()) {
    const path = prefix ? `${prefix}/${name}` : name
    check(!path.includes('\\') && !/[\r\n]/.test(path), `unsafe file path: ${path}`)
    const stat = lstatSync(join(root, path))
    check(!stat.isSymbolicLink(), `symlink is forbidden: ${path}`)
    if (stat.isDirectory()) result.push(...paths(root, path))
    else { check(stat.isFile(), `non-regular file: ${path}`); result.push(path) }
  }
  return result.sort()
}

export function inventory(root) {
  return paths(root).filter((path) => path !== RECORD).map((path) => {
    const bytes = readFileSync(join(root, path))
    return { path, size: bytes.length, sha256: digest(bytes) }
  })
}

export function normalize(root, locale) {
  for (const path of paths(root).filter((path) => /\.(html|css)$/.test(path))) {
    const file = join(root, path)
    const before = readFileSync(file, 'utf8')
    const after = before.replace(/(['"(])(?:https?:\/\/libtmux\.org)?\/_shell\//g, `$1/${locale}/_shell/`)
    if (before !== after) writeFileSync(file, after)
  }
}

export function recordBuild(root, inputs) {
  normalize(root, inputs.locale)
  const href = `/${inputs.locale}/${inputs.port}/${inputs.version}/${RECORD}`
  const link = `<link data-libtmux-provenance rel="describedby" type="application/json" href="${href}">`
  for (const path of paths(root).filter((path) => path.endsWith('.html'))) {
    const file = join(root, path)
    const before = readFileSync(file, 'utf8').replace(/<link data-libtmux-provenance[^>]*>/g, '')
    const after = /<\/head>/i.test(before) ? before.replace(/<\/head>/i, `${link}</head>`)
      : /^(\s*<!doctype[^>]*>)/i.test(before) ? before.replace(/^(\s*<!doctype[^>]*>)/i, `$1${link}`) : `${link}${before}`
    writeFileSync(file, after)
  }
  const record = { ...inputs, files: inventory(root) }
  check(record.files.some((file) => file.path === 'index.html'), 'version tree has no index.html')
  write(join(root, RECORD), record)
  return record
}

export function validateDescriptor(value, expected) {
  check(value?.schema === 1, 'missing artifact descriptor schema')
  check(value.artifact?.name === expected.name, 'artifact name differs from requested artifact')
  check(Number.isSafeInteger(value.artifact?.id) && value.artifact.id > 0, 'invalid artifact ID')
  check(DIGEST.test(value.artifact?.sha256 ?? ''), 'invalid artifact SHA256')
  check(/^[0-9]+$/.test(value.run?.id ?? ''), 'invalid artifact run ID')
  check(value.run?.repository === expected.repository && value.run?.id === String(expected.runId), 'artifact belongs to another repository/run')
  check(Number.isSafeInteger(value.run?.attempt) && value.run.attempt > 0 && value.run.attempt <= Number(expected.attempt), 'invalid artifact run attempt')
  check(SHA.test(value.sourceSha ?? ''), 'invalid source SHA')
  return value
}

// The pinned download action validates against GitHub's digest. Check the
// descriptor's digest too, before extracting any caller-controlled archive.
export function unpackArchive(directory, descriptor, out) {
  const files = paths(directory)
  check(files.length === 1, 'expected exactly one downloaded archive')
  const archive = join(directory, files[0])
  check(digest(readFileSync(archive)) === descriptor.artifact.sha256, 'artifact archive SHA256 differs from descriptor')
  execFileSync('python3', ['-c', `
import pathlib, stat, sys, zipfile
root = pathlib.Path(sys.argv[2])
root.mkdir(parents=True, exist_ok=False)
with zipfile.ZipFile(sys.argv[1]) as archive:
    seen = set()
    for item in archive.infolist():
        path = pathlib.PurePosixPath(item.filename)
        if not path.parts or path.as_posix() != item.filename.rstrip("/") or path.is_absolute() or ".." in path.parts or "\\\\" in item.filename or path.as_posix() in seen:
            raise ValueError("unsafe or duplicate artifact path: " + item.filename)
        seen.add(path.as_posix())
        mode = item.external_attr >> 16
        if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) and not (stat.S_ISREG(mode) or stat.S_ISDIR(mode))):
            raise ValueError("non-regular artifact entry: " + item.filename)
    archive.extractall(root)
`, archive, out], { stdio: 'pipe' })
}

export function verifyBuild(root, expected) {
  validateRoute(expected.version, expected.locale)
  const record = json(join(root, RECORD))
  const port = PORT_BY_SLUG[expected.port]
  check(port?.repo === expected.repository, 'caller repository does not own this port')
  workflowIdentity(expected.publisherRepository, expected.publisherSha)
  check(record.schema === 1 && record.port === expected.port && record.version === expected.version && record.locale === expected.locale,
    'build identity differs from publication destination')
  check(record.docs?.repository === expected.publisherRepository && record.docs?.sha === expected.publisherSha,
    'builder docs SHA differs from publisher workflow SHA')
  check(record.docs.dirty === false, 'docs inputs are dirty')
  const products = record.port === 'py' ? ['core', 'workspace', 'mcp'] : ['core']
  check(JSON.stringify(record.sources?.map((source) => source.product)) === JSON.stringify(products), 'missing or unexpected source products')
  const repositories = [port.repo, 'tmux-python/tmuxp', 'tmux-python/libtmux-mcp']
  record.sources.forEach((source, index) => {
    check(source.repository === repositories[index] && SHA.test(source.sha ?? ''), 'invalid source repository/SHA')
    check(source.dirty === false, 'source inputs are dirty')
  })
  check(record.sources[0].sha === expected.sourceSha, 'source SHA differs from builder artifact descriptor')
  check(expected.prefix === `${record.locale}/${record.port}/${record.version}`, 'destination prefix differs from build')
  // Normalization must already have happened in the builder. Any byte changed
  // here makes the inventory fail, rather than silently publishing other bytes.
  normalize(root, record.locale)
  check(Array.isArray(record.files) && record.files.some((file) => file.path === 'index.html'), 'version tree has no index.html')
  check(JSON.stringify(record.files) === JSON.stringify(inventory(root)), 'content inventory differs (changed, missing, extra, or duplicate files)')
  return record
}

export function receipt(root, descriptor, expected) {
  verifyBuild(root, { ...expected, sourceSha: descriptor.sourceSha })
  return {
    build: { url: `/${expected.prefix}/${RECORD}`, sha256: digest(readFileSync(join(root, RECORD))) },
    artifact: descriptor.artifact,
    run: { url: `https://github.com/${descriptor.run.repository}/actions/runs/${descriptor.run.id}`, attempt: descriptor.run.attempt },
    publisher: workflowIdentity(expected.publisherRepository, expected.publisherSha),
    destination: { prefix: `${expected.prefix}/`, url: `https://libtmux.org/${expected.prefix}/` },
  }
}


function expected(env) {
  return { port: env.PORT, version: env.VERSION, locale: env.LOCALE || 'en', prefix: env.PREFIX,
    publisherRepository: env.PUBLISHER_REPOSITORY, publisherSha: env.PUBLISHER_SHA,
    name: env.ARTIFACT_NAME, repository: env.GITHUB_REPOSITORY, runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT }
}

function main() {
  const [command, first, second, third] = process.argv.slice(2)
  const env = process.env
  if (command === 'snapshot') write(first, snapshot(second, env))
  else if (command === 'record') recordBuild(first, json(second))
  else if (command === 'workflow') workflowIdentity(env.PUBLISHER_REPOSITORY, env.PUBLISHER_SHA)
  else if (command === 'descriptor') {
    const value = { schema: 1, artifact: { id: Number(env.ARTIFACT_ID), name: env.ARTIFACT_NAME, sha256: env.ARTIFACT_DIGEST },
      run: { repository: env.GITHUB_REPOSITORY, id: env.GITHUB_RUN_ID, attempt: Number(env.GITHUB_RUN_ATTEMPT) }, sourceSha: env.SOURCE_SHA }
    write(first, validateDescriptor(value, expected(env)))
  } else if (command === 'select') {
    const value = validateDescriptor(json(first), expected(env))
    appendFileSync(env.GITHUB_OUTPUT, `artifact-id=${value.artifact.id}\n`)
  } else if (command === 'unpack') unpackArchive(first, validateDescriptor(json(second), expected(env)), third)
  else if (command === 'verify') write(third, receipt(first, validateDescriptor(json(second), expected(env)), expected(env)))
  else fail(`unknown command: ${command}`)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
