#!/usr/bin/env node
/**
 * Doc-comment examples keep the indentation and the lines their source gave them.
 *
 * Every model stores an example's code as text. Rewriting the comment
 * margin can take more than the margin: the Java `{@code}` converter once
 * trimmed each line, so `TmuxEnvironment`'s example showed every statement
 * flush left and nothing failed, because the code still parsed and every
 * link still resolved.
 *
 * Each multi-line example is found in its declaration's source file at the
 * revision the model records and its relative indentation compared line by
 * line. A source line between the example's first and last lines that the
 * example lacks is a dropped line: the shared Markdown parser once removed
 * every `# comment` line from every language's examples. A block the source does not contain verbatim (a doctest prompt, a
 * fence rewritten on the way in) is counted as unlocated, not as wrong. A port
 * without its checkout is reported as skipped.
 *
 * Usage: node scripts/check-example-indentation.mjs [--port java] [--model file.json]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PORTS } from '../site/src/lib/ports.ts'
import { compareIndentation } from './lib/example-indentation.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const expand = (path) => (path.startsWith('~/') ? join(homedir(), path.slice(2)) : path)
const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}
const only = arg('--port')
const modelOverride = arg('--model')

/** Product repositories that are not the port's own. */
const PRODUCT_CHECKOUT = {
  'tmux-python/tmuxp': '~/work/python/tmuxp',
  'tmux-python/libtmux-mcp': '~/work/python/libtmux-mcp',
}

const read = (repo, revision, file) => {
  try {
    return execFileSync('git', ['-C', repo, 'show', `${revision}:${file}`], {
      encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return undefined
  }
}

/** Every example with the source location of the comment that holds it. */
function* examplesOf(model) {
  for (const symbol of model.symbols) {
    for (const example of symbol.doc?.examples ?? []) yield { id: symbol.id, example, source: symbol.source }
    for (const signature of symbol.signatures) {
      for (const example of signature.doc?.examples ?? []) yield { id: symbol.id, example, source: signature.source ?? symbol.source }
    }
    for (const declaration of symbol.declarations ?? []) {
      for (const example of declaration.doc?.examples ?? []) yield { id: symbol.id, example, source: declaration.source ?? symbol.source }
    }
  }
}

let failed = 0
let skipped = 0
const rows = []
for (const port of PORTS) {
  if (only && only !== port.slug) continue
  const modelPath = modelOverride ?? join(repoRoot, 'site/src/data/api', `${port.slug}.json`)
  const checkout = expand(process.env[`LIBTMUX_DOCS_CHECKOUT_${port.slug.toUpperCase()}`] || port.checkout)
  if (!existsSync(modelPath) || !existsSync(checkout)) {
    console.log(`check-example-indentation: ${port.slug} skipped, no ${existsSync(modelPath) ? `checkout at ${port.checkout}` : 'model'}`)
    skipped++
    continue
  }
  const model = JSON.parse(readFileSync(modelPath, 'utf8'))
  const counts = { blocks: 0, ok: 0, lost: 0, dropped: 0, unlocated: 0, single: 0, file: 0 }
  const files = new Map()
  const lost = []
  for (const { id, example, source } of examplesOf(model)) {
    counts.blocks++
    // A complete example is its own source file, not a comment.
    if (example.sourceUrl) { counts.file++; continue }
    const repo = expand(PRODUCT_CHECKOUT[source.repo] ?? checkout)
    const key = `${repo}\0${source.file}`
    if (!files.has(key)) {
      files.set(key, read(repo, source.extractedRevision ?? source.revision, source.file) ??
        read(repo, source.revision, source.file) ?? '')
    }
    const result = compareIndentation(example.code, files.get(key), { rust: port.slug === 'rs' && /^rust$/i.test(example.lang) })
    counts[result.status]++
    if (result.status === 'lost') lost.push(`${id}: "${result.line.trim()}" is ${result.found} deep, its source comment ${result.expected}`)
    if (result.status === 'dropped') lost.push(`${id}: the example lacks the source line "${result.line}"`)
  }
  rows.push({ port: port.slug, ...counts })
  for (const line of lost.slice(0, 10)) console.error(`check-example-indentation: ${port.slug}: ${line}`)
  failed += lost.length
}
console.table(rows)
if (skipped) console.log(`check-example-indentation: ${skipped} port(s) skipped`)
if (failed) {
  console.error(`check-example-indentation: ${failed} example(s) lost indentation or lines`)
  process.exit(1)
}
