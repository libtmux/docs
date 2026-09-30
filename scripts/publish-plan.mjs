#!/usr/bin/env node
// Plan a publish.yml dispatch: which reviewed port workflows and inputs to use.
// One dispatch publishes any set of ports at a ref:
//
// - `latest` publishes each port's default branch as `latest`. It is the
//   default version only while the port has no stable release, the rule a
//   trunk push follows (scripts/port-docs-identity.sh).
// - `release` republishes each port's newest release tag, plus `next` for a
//   prerelease or `stable` (the default) for a release, as a tag push does.
// - Any other ref is one port's exact ref, published as the inputs name it.
//
// Dispatch capability and the caller branch come from the port catalog.
// User-selected source refs never choose which workflow revision executes.
//
// Prints the matrix as JSON on stdout and a Markdown table on stderr.

import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const KINDS = ['trunk', 'tag', 'alias']

function fail(message) {
  throw new Error(`publish-plan: ${message}`)
}

/** A port's version slug for a tag: the tag without its prefix. */
function versionOf(tag, port) {
  return port.tagPrefix ? tag.slice(port.tagPrefix.length) : tag
}

/**
 * The dispatches one publish.yml run makes.
 *
 * @param {{ ports: string, ref: string, version?: string, versionKind?: string, isDefault?: boolean, resolvesTo?: string }} inputs
 * @param {readonly { slug: string, repo: string, tagPrefix?: string, tagGrammar: string, docsDispatch?: { workflow: string, ref?: string, language?: string } }[]} catalog
 * @param {(repo: string) => { defaultBranch: string, tags: string[] }} lookup
 * @param {{ releaseTag: Function, newestPublishedTag: Function, packageVersionIsPrerelease: Function }} versions
 */
export function plan(inputs, catalog, lookup, versions) {
  const dispatchable = catalog.filter((port) => port.docsDispatch)
  const wanted = inputs.ports.trim() === 'all'
    ? dispatchable
    : inputs.ports.split(',').map((slug) => slug.trim()).filter(Boolean).map((slug) => {
      const port = catalog.find((candidate) => candidate.slug === slug)
      if (!port) fail(`unknown port ${slug}`)
      if (!dispatchable.includes(port)) fail(`${slug} has no dispatchable docs workflow`)
      return port
    })
  if (wanted.length === 0) fail('no ports selected')

  const ref = inputs.ref.trim()
  if (!ref) fail('source ref is required')
  const exact = ref !== 'latest' && ref !== 'release'
  if (exact && wanted.length !== 1) fail(`an exact ref (${ref}) names one port's source; select one port`)
  if (!exact && (inputs.version || (inputs.versionKind && inputs.versionKind !== 'auto') || inputs.resolvesTo)) {
    fail(`version, version-kind and resolves-to apply only to an exact ref, not ${ref}`)
  }

  const entries = []
  const sources = new Map()
  for (const port of wanted) {
    const repository = /^([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9_.-]+)$/.exec(port.repo)
    if (!repository) fail(`invalid repository for ${port.slug}: ${port.repo}`)
    const dispatch = port.docsDispatch
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml$/.test(dispatch.workflow)) {
      fail(`invalid docs workflow for ${port.slug}: ${dispatch.workflow}`)
    }
    if (dispatch.ref !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(dispatch.ref)) {
      fail(`invalid docs workflow ref for ${port.slug}: ${dispatch.ref}`)
    }
    if (dispatch.language !== undefined && dispatch.language !== port.slug) {
      fail(`docs language for ${port.slug} must select itself`)
    }
    if (!sources.has(port.repo)) sources.set(port.repo, lookup(port.repo))
    const { defaultBranch, tags } = sources.get(port.repo)
    const base = { port: port.slug, repo: port.repo, repoOwner: repository[1], repoName: repository[2],
      workflow: dispatch.workflow, dispatchRef: dispatch.ref ?? defaultBranch, language: dispatch.language ?? '' }
    const releases = tags.filter((tag) => versions.releaseTag(tag, port) !== null)
    if (ref === 'latest') {
      const stable = releases.some((tag) => !versions.packageVersionIsPrerelease(versionOf(tag, port), port.tagGrammar))
      entries.push({ ...base, sourceRef: defaultBranch, version: 'latest', kind: 'trunk', isDefault: !stable, resolvesTo: '' })
    } else if (ref === 'release') {
      const tag = versions.newestPublishedTag(releases, port, null)
      if (!tag) continue
      const version = versionOf(tag, port)
      const alias = versions.packageVersionIsPrerelease(version, port.tagGrammar) ? 'next' : 'stable'
      entries.push({ ...base, sourceRef: tag, version, kind: 'tag', isDefault: false, resolvesTo: '' })
      entries.push({ ...base, sourceRef: tag, version: alias, kind: 'alias', isDefault: alias === 'stable', resolvesTo: version })
    } else {
      const kind = inputs.versionKind
      if (!KINDS.includes(kind)) fail(`an exact ref needs version-kind trunk, tag or alias, not ${kind || 'auto'}`)
      if (!SLUG.test(inputs.version ?? '')) fail(`invalid version slug: ${inputs.version ?? ''}`)
      if (kind === 'alias' && !inputs.resolvesTo) fail('an alias requires resolves-to')
      if (kind !== 'alias' && inputs.resolvesTo) fail('resolves-to applies only to aliases')
      entries.push({ ...base, sourceRef: ref, version: inputs.version, kind, isDefault: Boolean(inputs.isDefault), resolvesTo: inputs.resolvesTo ?? '' })
    }
  }
  return entries
}

/** The Markdown summary of a plan. */
export function summary(entries, dryRun) {
  const rows = entries.map((e) =>
    `| ${e.port} | \`${e.repo}/${e.workflow}@${e.dispatchRef}\` | \`${e.sourceRef}\` | ${e.version} | ${e.kind}${e.resolvesTo ? ` → ${e.resolvesTo}` : ''} | ${e.isDefault ? 'yes' : ''} |`)
  return [
    `### ${dryRun ? 'Dry run: would publish' : 'Publishing'} ${entries.length} version(s)`,
    '',
    '| Port | Caller | Source | Version | Kind | Default |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n')
}

function lookup(repo) {
  const url = `https://github.com/${repo}`
  const head = execFileSync('git', ['ls-remote', '--symref', url, 'HEAD'], { encoding: 'utf8' })
  const defaultBranch = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(head)?.[1]
  if (!defaultBranch) fail(`cannot read ${repo}'s default branch`)
  const tags = execFileSync('git', ['ls-remote', '--tags', '--refs', url], { encoding: 'utf8' })
    .split('\n').filter(Boolean).map((line) => line.replace(/^.*refs\/tags\//, ''))
  return { defaultBranch, tags }
}

async function main() {
  const env = process.env
  const { PORTS } = await import(resolve(root, 'site/src/lib/ports.ts'))
  const versions = await import(resolve(root, 'site/src/lib/versions.ts'))
  const entries = plan({
    ports: env.INPUT_PORTS ?? 'all',
    ref: env.INPUT_REF ?? 'latest',
    version: env.INPUT_VERSION ?? '',
    versionKind: env.INPUT_KIND ?? 'auto',
    isDefault: env.INPUT_DEFAULT === 'true',
    resolvesTo: env.INPUT_RESOLVES_TO ?? '',
  }, PORTS, lookup, versions)
  process.stdout.write(`${JSON.stringify({ include: entries })}\n`)
  process.stderr.write(summary(entries, env.INPUT_DRY_RUN !== 'false'))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  })
}
