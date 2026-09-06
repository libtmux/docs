#!/usr/bin/env node
/**
 * Every source path this site cites must exist in the port it names.
 *
 * The examples and topics pages carry their code three ways: read straight
 * out of a checkout by `file="..."` (the remark plugin fails the build if
 * that file is gone), hand-quoted under a `// From <path>` comment, and named
 * in each page's "Where this comes from" table. Only the first is
 * self-checking. The other two are prose, and prose does not notice when a
 * port renames the file it points at — the page keeps rendering, with a
 * citation that leads nowhere.
 *
 * This closes that gap: it resolves every cited path against the port's own
 * checkout and fails when one is missing. It deliberately does NOT require a
 * hand-quoted fence to be byte-identical to its source — several are quoted
 * excerpts with clarifying comments added, which is legitimate and is what
 * the tables already say ("hand-quoted"). A wrong path is a bug; a shortened
 * quote is an editorial choice.
 *
 * Usage: node scripts/check-citations.mjs [--json]
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHECKOUTS, LANG_TO_PORT, expand } from '../site/src/plugins/remark-port-code.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const contentRoot = join(repoRoot, 'site/src/content/docs')

/** Port name as the provenance tables spell it, to its slug. */
const TABLE_PORT = {
  python: 'py',
  typescript: 'ts',
  javascript: 'ts',
  rust: 'rs',
  go: 'go',
  java: 'java',
  kotlin: 'java',
  '.net': 'dotnet',
  dotnet: 'dotnet',
  'c#': 'dotnet',
  'c++': 'cxx',
  cxx: 'cxx',
  cpp: 'cxx',
  swift: 'swift',
}

/**
 * Does this backticked span look like a path rather than a symbol?
 *
 * Tables cite both — `src/libtmux/pane.py` and `capture_pane` sit in the same
 * cell — and only the first can be resolved on disk. Requiring a slash *and*
 * an extension keeps `Pane.CaptureAsync` and `README.md`-adjacent prose like
 * `docs-tests` out, at the cost of not checking a bare root-level filename,
 * which is the right trade: a false alarm here would train people to ignore
 * the check.
 */
function looksLikePath(s) {
  return s.includes('/') && /\.[A-Za-z0-9]{1,6}$/.test(s) && !s.startsWith('http') && !s.startsWith('/')
}

function* markdownFiles(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* markdownFiles(full)
    else if (name.endsWith('.md')) yield full
  }
}

const problems = []
const checked = []

for (const file of markdownFiles(contentRoot)) {
  const rel = file.slice(repoRoot.length + 1)
  const lines = readFileSync(file, 'utf8').split('\n')

  let fenceLang = null
  let sectionPort = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    const fence = line.match(/^```(\S+)?(.*)$/)
    if (fence) {
      if (fenceLang !== null) {
        fenceLang = null
        continue
      }
      fenceLang = (fence[1] ?? '').toLowerCase()
      // `file="..."` is already enforced by the remark plugin, but record it
      // so the summary reports total coverage rather than only the weak half.
      const meta = fence[2] ?? ''
      const fileAttr = meta.match(/file="([^"]+)"/)
      if (fileAttr) {
        const port = LANG_TO_PORT[fenceLang]
        record(port, fileAttr[1], rel, i + 1, 'file= fence')
      }
      continue
    }

    if (fenceLang !== null) {
      // `// From examples/quickstart/main.go, shown in full on ...`
      const from = line.match(/^\s*(?:\/\/|#|--|;)\s*From\s+([^\s,]+)/)
      // A possessive reads naturally in prose ("scratch.rs's wait_for_text")
      // and is not part of the path. Strip it rather than reporting a miss.
      if (from) record(LANG_TO_PORT[fenceLang], from[1].replace(/'s$/, ''), rel, i + 1, 'From comment')
      continue
    }

    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/)
    if (heading) sectionPort = TABLE_PORT[heading[1].toLowerCase()] ?? null

    if (sectionPort && !line.startsWith('|')) {
      for (const m of line.matchAll(/`([^`]+)`/g)) {
        if (looksLikePath(m[1])) record(sectionPort, m[1], rel, i + 1, 'port section')
      }
    }

    // Provenance table row: | Python | `src/libtmux/pane.py` (...) | ... |
    if (line.startsWith('|')) {
      const cells = line.split('|').map((c) => c.trim())
      const port = TABLE_PORT[(cells[1] ?? '').toLowerCase()]
      if (!port) continue
      for (const m of line.matchAll(/`([^`]+)`/g)) {
        if (looksLikePath(m[1])) record(port, m[1], rel, i + 1, 'provenance table')
      }
    }
  }
}

function record(port, path, file, line, kind) {
  if (!port) return
  const root = CHECKOUTS[port]
  if (!root) return
  const abs = join(expand(root), path)
  checked.push({ port, path })
  if (!existsSync(abs)) problems.push({ port, path, file, line, kind })
}

const asJson = process.argv.includes('--json')
if (asJson) {
  console.log(JSON.stringify({ checked: checked.length, problems }, null, 2))
} else {
  const byPort = {}
  for (const c of checked) byPort[c.port] = (byPort[c.port] ?? 0) + 1
  console.log(
    `check-citations: ${checked.length} cited paths across ${Object.keys(byPort).length} ports ` +
      `(${Object.entries(byPort).map(([p, n]) => `${p}:${n}`).join(' ')})`,
  )
  for (const p of problems) {
    console.error(`  MISSING  ${p.file}:${p.line}  [${p.kind}]  ${p.port}: ${p.path}`)
  }
}

if (problems.length) {
  console.error(`check-citations: ${problems.length} cited path(s) do not exist in their port's checkout`)
  process.exit(1)
}
