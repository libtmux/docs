#!/usr/bin/env node
/**
 * Extract every port's MCP tool names from that port's own registration site.
 *
 * `/mcp/` used to assert that "tool names and arguments are kept in step
 * across ports" with nothing behind it. They are not, and no single port's
 * documentation can show that — which is exactly why the claim survived.
 *
 * There is no shared manifest to read, so this encodes eight registration
 * idioms. That is the whole difficulty and the reason this is a script rather
 * than a hand-maintained table: each port declares tools in the way its
 * framework wants, and a grep for a plausible-looking string literal picks up
 * argument names, tmux command names and prose. Every pattern below anchors on
 * the registration call itself.
 *
 * Validation that the extraction is right rather than merely plausible: the
 * Python rule yields exactly 54 tools, and `libtmux-mcp/docs/tools/` contains
 * exactly 54 tool pages. An extractor that agrees with the reference
 * implementation's own documentation, name for name, is not guessing.
 *
 * Usage: node scripts/gen-mcp-tools.mjs [--out <path>] [--check]
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const expand = (p) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)

/**
 * How each port names a tool, and where it says so.
 *
 * `wirePrefix` is not cosmetic. Java and .NET put every tool behind `tmux_`,
 * so an agent configured for one of those two and pointed at any other port
 * finds no tool by the name it expects. It is stripped here so the comparison
 * is about capability rather than spelling, and reported separately.
 */
const PORTS = [
  {
    slug: 'py',
    dir: '~/work/python/libtmux-mcp/src/libtmux_mcp/tools',
    glob: '**/*.py',
    // FastMCP: mcp.tool(<annotations>)(function) — the function name is the
    // wire name. The decorator form is not used here.
    pattern: /mcp\.tool\((?:[^()]|\([^()]*\))*\)\(\s*(\w+)\s*\)/gs,
  },
  {
    slug: 'ts',
    dir: '~/work/libtmux/libtmux-ts/packages/mcp/src',
    glob: '**/*.ts',
    pattern: /registerTool\(\s*"([a-z_]+)"/gs,
  },
  {
    slug: 'rs',
    dir: '~/work/libtmux/libtmux-rs/crates/tmux-mcp/src/tools',
    glob: '*.rs',
    // rmcp derives the name from the annotated function.
    pattern: /#\[tool\((?:[^()]|\([^()]*\))*\)\]\s*(?:#\[[^\]]*\]\s*)*pub async fn (\w+)/gs,
  },
  {
    slug: 'go',
    dir: '~/work/libtmux/libtmux-go/mcp',
    glob: '*.go',
    // Tests build their own tool descriptors with the same field, so the
    // unfiltered scan finds nine names no server ever registers ("fish",
    // "errexit", "before"). Excluding them is not tidiness; it is the
    // difference between 60 tools and 69.
    exclude: ['*_test.go', 'examples', 'cmd'],
    // Anchored on the Tool literal, not the bare `Name:` field: the Go SDK
    // uses the same field for `mcp.Implementation`, so the unanchored scan
    // counted the *server's* own name ("libtmux") as a tool.
    pattern: /&mcp\.Tool\{\s*Name:\s+"([a-z_]+)"/gs,
  },
  {
    slug: 'java',
    dir: '~/work/libtmux/libtmux-java/libtmux-mcp/src/main/java/io/github/libtmux/mcp',
    glob: 'Catalog.java',
    // Anchored on the registration helper rather than the prefix, so an
    // unprefixed tool would show up as a prefix violation below instead of
    // silently not existing.
    pattern: /ToolSpec\.of\(\s*"(?:tmux_)?([a-z_]+)"/gs,
    prefixProbe: /ToolSpec\.of\(\s*"([a-z_]+)"/gs,
    wirePrefix: 'tmux_',
  },
  {
    slug: 'dotnet',
    dir: '~/work/libtmux/libtmux-dotnet/src/LibTmux.Mcp',
    glob: '**/*.cs',
    pattern: /McpServerTool\(Name = "tmux_([a-z_]+)"/g,
    prefixProbe: /McpServerTool\(Name = "([a-z_]+)"/g,
    wirePrefix: 'tmux_',
  },
  {
    slug: 'cxx',
    dir: '~/work/libtmux/libtmux-cxx/apps/mcp/src',
    glob: 'tool_catalog.cpp',
    // Parameters use the same `.name =` field, so anchor on the Tool literal.
    pattern: /Tool\{\s*\.name = "([a-z_]+)"/g,
  },
  {
    slug: 'swift',
    dir: '~/work/libtmux/libtmux-swift/Sources/LibTmuxMCP',
    glob: 'ToolOperation.swift',
    // ToolCatalog does `self.name = operation.rawValue`, and Swift derives an
    // absent rawValue from the case name — so `case snapshot` is the tool
    // "snapshot". Matching only the explicit form silently dropped three
    // tools, two of which (`rename`, `select`) Java also registers, which is
    // how it was found: a name cannot be unique to one port and shared.
    // The file holds exactly one enum, which is what makes a bare `case` safe.
    pattern: /^\s*case (\w+?)(?:\s*=\s*"([a-z_]+)")?\s*$/gm,
    capture: (m) => m[2] ?? m[1],
  },
]

/*
 * This table is MCP server locations and extraction patterns, not port
 * identity, so it does not belong in ports.ts. What does belong there is the
 * set of ports, and the two silently diverging is how a ninth port gets an
 * empty comparison instead of an error.
 */
const portsModule = resolve(dirname(dirname(fileURLToPath(import.meta.url))), 'site/src/lib/ports.ts')
const { PORTS: PORT_DEFS } = await import(`file://${portsModule}`)
const declaredSlugs = new Set(PORT_DEFS.map((port) => port.slug))
const coveredSlugs = new Set(PORTS.map((port) => port.slug))
const absentHere = [...declaredSlugs].filter((slug) => !coveredSlugs.has(slug))
const absentThere = [...coveredSlugs].filter((slug) => !declaredSlugs.has(slug))
if (absentHere.length || absentThere.length) {
  console.error('gen-mcp-tools: this table and ports.ts disagree about which ports exist.')
  if (absentHere.length) console.error(`  declared in ports.ts, absent here: ${absentHere.join(', ')}`)
  if (absentThere.length) console.error(`  present here, absent from ports.ts: ${absentThere.join(', ')}`)
  process.exit(1)
}


function filesIn(dir, glob, exclude = []) {
  try {
    const args = ['--type', 'f', '--glob', glob, '--base-directory', dir, '--absolute-path']
    for (const e of exclude) args.push('--exclude', e)
    const out = execFileSync('fd', args, { encoding: 'utf8' })
    return out.split('\n').filter(Boolean).filter((f) => !f.includes('__pycache__'))
  } catch {
    return []
  }
}

const results = {}
const missing = []
for (const port of PORTS) {
  const dir = expand(port.dir)
  if (!existsSync(dir)) {
    missing.push(port.slug)
    continue
  }
  const names = new Set()
  for (const file of filesIn(dir, port.glob, port.exclude)) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(port.pattern)) names.add(port.capture ? port.capture(m) : m[1])
  }
  results[port.slug] = {
    tools: [...names].sort(),
    wirePrefix: port.wirePrefix ?? '',
    source: port.dir,
  }
}

if (missing.length) {
  console.error(`gen-mcp-tools: no checkout for ${missing.join(', ')} — refusing to write a partial matrix`)
  process.exit(1)
}

// A port that declares a wire prefix must use it for *every* tool. Without
// this the prefix-stripping pattern is self-confirming: an unprefixed tool
// would simply not be found, and the claim "Java and .NET prefix every tool"
// would be true only of the tools the instrument can see.
for (const port of PORTS) {
  if (!port.prefixProbe) continue
  const violations = new Set()
  for (const file of filesIn(expand(port.dir), port.glob, port.exclude)) {
    for (const m of readFileSync(file, 'utf8').matchAll(port.prefixProbe)) {
      if (!m[1].startsWith(port.wirePrefix)) violations.add(m[1])
    }
  }
  if (violations.size) {
    console.error(
      `gen-mcp-tools: ${port.slug} declares wirePrefix "${port.wirePrefix}" but ` +
        `${violations.size} tool(s) do not carry it: ${[...violations].sort().join(', ')}`,
    )
    process.exit(1)
  }
}

// Cross-check against the reference implementation's own documentation.
const docsDir = expand('~/work/python/libtmux-mcp/docs/tools')
let documented = null
if (existsSync(docsDir)) {
  documented = filesIn(docsDir, '*.md')
    .map((f) => f.split('/').pop().replace(/\.md$/, '').replaceAll('-', '_'))
    .filter((n) => n !== 'index')
    .sort()
  const extracted = results.py.tools
  const onlyDocs = documented.filter((n) => !extracted.includes(n))
  const onlyCode = extracted.filter((n) => !documented.includes(n))
  if (onlyDocs.length || onlyCode.length) {
    console.error('gen-mcp-tools: Python extraction disagrees with libtmux-mcp/docs/tools/')
    if (onlyDocs.length) console.error(`  documented, not extracted: ${onlyDocs.join(', ')}`)
    if (onlyCode.length) console.error(`  extracted, not documented: ${onlyCode.join(', ')}`)
    process.exit(1)
  }
}

const slugs = PORTS.map((p) => p.slug)
const universe = [...new Set(slugs.flatMap((s) => results[s].tools))].sort()
const coverage = Object.fromEntries(
  universe.map((t) => [t, slugs.filter((s) => results[s].tools.includes(t))]),
)

const payload = {
  generated: 'scripts/gen-mcp-tools.mjs',
  ports: results,
  universe,
  coverage,
  referenceDocumented: documented?.length ?? null,
}

const outFlag = process.argv.indexOf('--out')
const out = outFlag === -1 ? join(repoRoot, 'site/src/data/mcp-tools.json') : process.argv[outFlag + 1]
const text = JSON.stringify(payload, null, 2) + '\n'

if (process.argv.includes('--check')) {
  const current = existsSync(out) ? readFileSync(out, 'utf8') : ''
  if (current !== text) {
    console.error(`gen-mcp-tools: ${out} is stale — re-run without --check`)
    process.exit(1)
  }
  console.log(`gen-mcp-tools: ${out} is current (${universe.length} tools across ${slugs.length} ports)`)
} else {
  writeFileSync(out, text)
  console.log(
    `gen-mcp-tools: ${universe.length} distinct tools across ${slugs.length} ports ` +
      `(${slugs.map((s) => `${s}:${results[s].tools.length}`).join(' ')}) -> ${out}`,
  )
}
