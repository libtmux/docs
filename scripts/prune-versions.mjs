#!/usr/bin/env node
/**
 * Remove deployed version prefixes the manifest no longer lists.
 *
 * `reusable-deploy.yml` syncs each build with `--delete`, which removes files
 * *within* a prefix that the build stopped producing. Nothing removes a
 * prefix once it stops being built at all: retire `v0.9` from
 * `versions.json` and its tree stays in the bucket forever, still reachable,
 * still crawlable, and no longer reachable from any switcher — the worst
 * combination, because nothing links to it and nothing says it is stale.
 *
 * So this reconciles the other direction: list what the bucket has under each
 * port, compare against what the manifest says is supported, and delete the
 * difference.
 *
 * Refuses to run without an explicit `--apply`. The failure mode here is
 * deleting a live version because a manifest was half-written, and a dry run
 * that prints the prefixes is the cheapest guard against it.
 *
 * Usage:
 *   prune-versions.mjs --bucket B --manifest versions.json [--apply]
 *   prune-versions.mjs --bucket B --manifest versions.json --listing FILE
 *
 * `--listing` reads `aws s3 ls` output from a file instead of calling AWS, so
 * the reconciliation can be tested without a bucket.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { argv } from 'node:process'
import { fileURLToPath } from 'node:url'

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}
const apply = process.argv.includes('--apply')

/**
 * Version slugs the manifest still stands behind, per port.
 *
 * Unsupported and end-of-life entries are deliberately kept: an EOL version
 * is still published, still linked from the switcher with a banner, and
 * deleting it would break every link anyone ever wrote to it. What gets
 * pruned is a version the manifest stopped mentioning at all.
 */
export function keptVersions(manifest) {
  const kept = new Map()
  for (const [port, entries] of Object.entries(manifest.ports ?? {})) {
    kept.set(port, new Set((entries ?? []).map((e) => e.slug)))
  }
  return kept
}

/** Directory names under `<port>/` in an `aws s3 ls` listing. */
export function prefixesFrom(listing) {
  return listing
    .split('\n')
    .map((l) => /^\s*PRE\s+(.+?)\/\s*$/.exec(l)?.[1])
    .filter((x) => typeof x === 'string')
}

/**
 * Prefixes to delete: present in the bucket, absent from the manifest.
 *
 * A port the manifest does not mention at all is left alone rather than
 * emptied. That is what an ecosystem port looks like — no local tree and no
 * manifest entry — and also what a half-written manifest looks like, so the
 * safe reading of "no entry" is "not mine to touch".
 */
export function toPrune(kept, present) {
  const out = []
  for (const [port, versions] of present) {
    const allowed = kept.get(port)
    if (!allowed || allowed.size === 0) continue
    for (const version of versions) {
      if (!allowed.has(version)) out.push(`${port}/${version}`)
    }
  }
  return out.sort()
}


/**
 * The CLI, run only when this file is the entry point.
 *
 * The rules above are imported by the test suite, and a module that deletes
 * S3 prefixes on import is a module nobody can safely import.
 */
if (fileURLToPath(import.meta.url) === argv[1]) {
  const bucket = arg('bucket')
  const manifestPath = arg('manifest')
  const listingPath = arg('listing')

  if (!manifestPath || (!bucket && !listingPath)) {
    console.error('usage: prune-versions.mjs --bucket B --manifest versions.json [--apply]')
    process.exit(2)
  }

  function listPort(port) {
    if (listingPath) {
      const all = JSON.parse(readFileSync(listingPath, 'utf8'))
      return prefixesFrom(all[port] ?? '')
    }
    const out = execFileSync('aws', ['s3', 'ls', `s3://${bucket}/${port}/`], { encoding: 'utf8' })
    return prefixesFrom(out)
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const kept = keptVersions(manifest)
  const present = new Map()
  for (const port of kept.keys()) {
    try {
      present.set(port, listPort(port))
    } catch {
      // A port with no prefix in the bucket has never been deployed. Not an
      // error, and nothing to prune.
    }
  }

  const stale = toPrune(kept, present)
  if (stale.length === 0) {
    console.log('nothing to prune: every deployed version is still in the manifest')
    process.exit(0)
  }

  console.log(`${stale.length} deployed version${stale.length === 1 ? '' : 's'} no longer in the manifest:`)
  for (const prefix of stale) console.log(`  ${prefix}/`)

  if (!apply) {
    console.log('\ndry run; pass --apply to delete these prefixes')
    process.exit(0)
  }

  for (const prefix of stale) {
    console.log(`deleting s3://${bucket}/${prefix}/`)
    execFileSync('aws', ['s3', 'rm', `s3://${bucket}/${prefix}/`, '--recursive'], { stdio: 'inherit' })
  }

}
