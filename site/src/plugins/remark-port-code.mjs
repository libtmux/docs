import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { visit } from 'unist-util-visit'

/**
 * One prose source, per-language code.
 *
 * Playwright serves the same guide at /docs/intro and /python/docs/intro with
 * the code samples swapped. This does the same thing without duplicating the
 * prose: a page carries a fenced block per language, and a build for one port
 * drops the fences belonging to the others.
 *
 * The root build keeps every fence, which is what makes the cross-language
 * view work and what keeps a page readable while it is being written.
 */

/**
 * Fence language to port slug. A language absent here — console, json, yaml,
 * toml, diff — belongs to no port and always survives, because it is setup or
 * output rather than a language sample.
 */
/** @type {Record<string, string | undefined>} */
export const LANG_TO_PORT = {
  python: 'py',
  py: 'py',
  typescript: 'ts',
  ts: 'ts',
  javascript: 'ts',
  js: 'ts',
  rust: 'rs',
  rs: 'rs',
  go: 'go',
  golang: 'go',
  java: 'java',
  kotlin: 'java',
  csharp: 'dotnet',
  cs: 'dotnet',
  'c#': 'dotnet',
  cpp: 'cxx',
  'c++': 'cxx',
  cxx: 'cxx',
  swift: 'swift',
}

/**
 * Checkout root per port, mirroring ports.ts. Used to resolve `file=`.
 * @type {Record<string, string | undefined>}
 */
/**
 * Where a `file=` fence reads its example from.
 *
 * The `-docs` worktree, not the main checkout, and for the same reason the
 * reference generators use it: every port repository is public, so a change
 * an example needs — a `region:` marker delimiting the lines a page quotes —
 * cannot be committed to `master`. The worktrees sit on `docs-site`, which
 * pushes to the private fork, so a marker has somewhere to live.
 *
 * Reading the main checkout meant a marker added on `docs-site` was invisible
 * here while being visible to the reference build, which is a confusing half
 * state: the same file, two versions, depending on which part of the assembly
 * asked.
 *
 * Python has no worktree — its docs are built from the checkout directly.
 */
export const CHECKOUTS = {
  py: '~/work/python/libtmux',
  ts: '~/work/libtmux/libtmux-ts-docs',
  rs: '~/work/libtmux/libtmux-rs-docs',
  go: '~/work/libtmux/libtmux-go-docs',
  java: '~/work/libtmux/libtmux-java-docs',
  dotnet: '~/work/libtmux/libtmux-dotnet-docs',
  cxx: '~/work/libtmux/libtmux-cxx-docs',
  swift: '~/work/libtmux/libtmux-swift-docs',
}

export const expand = (p) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)

/**
 * Parse `file="examples/x.py"` and `region="name"` out of a fence's meta.
 * @param {string | null | undefined} meta
 * @returns {{ file?: string, region?: string }}
 */
export function parseMeta(meta) {
  if (!meta) return {}
  /** @type {Record<string, string>} */
  const out = {}
  for (const m of meta.matchAll(/(\w+)="([^"]*)"/g)) out[m[1]] = m[2]
  return out
}

/**
 * Slice a file between `# region: name` / `# endregion` style markers, so a
 * page can quote one function out of a longer tested example. The comment
 * leader varies by language, so match the marker text rather than the syntax.
 */
function sliceRegion(source, region) {
  const lines = source.split('\n')
  const start = lines.findIndex((l) => new RegExp(`region:\\s*${region}\\b`).test(l))
  if (start === -1) return null
  const end = lines.findIndex((l, i) => i > start && /endregion\b/.test(l))
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n')
}

export function remarkPortCode() {
  const port = process.env.LIBTMUX_DOCS_PORT || ''

  return (tree, file) => {
    const removals = []

    visit(tree, 'code', (node, index, parent) => {
      const lang = (node.lang || '').toLowerCase()
      const owner = LANG_TO_PORT[lang]
      const meta = parseMeta(node.meta)

      // A fence may name a file in that port's checkout instead of carrying a
      // copy of it. Reading it at build time is what stops a snippet drifting
      // from the code its own repository tests.
      if (meta.file && owner) {
        node.value = readFence(owner, meta, file?.path)
      }

      // Untagged fences and shared languages (console, json, ...) stay in
      // every build. Only a fence that belongs to a *different* port goes.
      if (port && owner && owner !== port) removals.push([parent, node])
    })

    for (const [parent, node] of removals) {
      const i = parent.children.indexOf(node)
      if (i !== -1) parent.children.splice(i, 1)
    }
  }
}

/**
 * The body of a `file="..."` fence, read from the port's checkout.
 *
 * Exported because the HTML pages are not the only consumer: llms-full.txt has
 * to inline the same content, and reading it from the Markdown *source* there
 * would ship a file full of empty code fences — precisely the source-versus-
 * resolved bug notes/research/10-llms-and-agents.md exists to document. One
 * reader, so the two cannot disagree.
 */
/**
 * @param {string} owner
 * @param {{ file?: string, region?: string }} meta
 * @param {string} [pagePath]
 * @returns {string}
 */
export function readFence(owner, meta, pagePath) {
  const abs = join(expand(CHECKOUTS[owner] ?? ''), meta.file)
  try {
    let source = readFileSync(abs, 'utf8')
    if (meta.region) {
      const sliced = sliceRegion(source, meta.region)
      if (sliced === null) throw new Error(`region "${meta.region}" not found`)
      source = sliced
    }
    return source.replace(/\s+$/, '')
  } catch (err) {
    // Fail the build rather than ship a silently empty example: a missing
    // tested source is exactly the drift this is meant to catch.
    throw new Error(`${pagePath ?? 'page'}: cannot inline ${meta.file} for ${owner} — ${err.message}`)
  }
}
