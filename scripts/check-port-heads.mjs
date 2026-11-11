#!/usr/bin/env node
/**
 * The matrix for .github/workflows/port-heads.yml: one leg per library family,
 * each naming the family's repository, the head commit of its default branch,
 * and the ports built from it.
 *
 * `node scripts/check-port-heads.mjs matrix` writes `matrix=<json>` to
 * $GITHUB_OUTPUT and prints it. The head is resolved with `git ls-remote`, so a
 * leg builds one fixed commit however long the queue is.
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORTS } from '../site/src/lib/ports.ts'

/**
 * Ports whose own repository builds the docs tree in its own workflow, exporting
 * the native model with tools it carries, and never calls port-docs.yml.
 */
export const OWN_WORKFLOW = ['lua', 'ruby']

/** One leg per core port; its wrappers share its repository and are built with it. */
export function matrix(headOf = defaultBranchHead, { own = false } = {}) {
  return {
    include: PORTS.filter((port) => !port.parentLibrary && OWN_WORKFLOW.includes(port.slug) === own).map((port) => ({
      port: port.slug,
      repo: port.repo,
      ref: headOf(port.repo),
      members: PORTS.filter((entry) => entry.slug === port.slug || entry.parentLibrary?.slug === port.slug).map((entry) => entry.slug).join(' '),
    })),
  }
}

function defaultBranchHead(repo) {
  const result = spawnSync('git', ['ls-remote', `https://github.com/${repo}.git`, 'HEAD'], { encoding: 'utf8' })
  const sha = result.stdout.split(/\s/)[0]
  if (result.status !== 0 || !/^[0-9a-f]{40}$/.test(sha)) throw new Error(`cannot resolve the default-branch head of ${repo}: ${result.stderr.trim()}`)
  return sha
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== 'matrix') throw new Error('usage: check-port-heads.mjs matrix')
  const all = matrix(defaultBranchHead, { own: false })
  const own = matrix(defaultBranchHead, { own: true })
  const outputs = { matrix: JSON.stringify(all), own: JSON.stringify(own), badges: JSON.stringify({ include: [...all.include, ...own.include] }) }
  for (const [name, json] of Object.entries(outputs)) {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${json}\n`)
    console.log(`${name}=${json}`)
  }
}
