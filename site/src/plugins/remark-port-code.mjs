import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolvePortBody, resolvePortContent } from '../lib/workspace-shared-slots.ts'
/** Static import keeps source bytes available in bundled HTML and Markdown exports. */
import CACHE from '../data/example-sources.json' with { type: 'json' }
import { visit } from 'unist-util-visit'

/**
 * Fence language to port slug. A language absent here — console, json, yaml,
 * toml, diff — belongs to no port and always survives, because it is setup or
 * output rather than a language sample.
 */
/** @type {Record<string, string | undefined>} */
export const LANG_TO_PORT = {
  python: 'py',
  py: 'py',
  ruby: 'ruby',
  rb: 'ruby',
  lua: 'lua',
  typescript: 'ts',
  ts: 'ts',
  javascript: 'ts',
  js: 'ts',
  rust: 'rs',
  rs: 'rs',
  go: 'go',
  golang: 'go',
  java: 'java',
  kotlin: 'kotlin',
  scala: 'scala',
  fsharp: 'fsharp',
  fs: 'fsharp',
  'f#': 'fsharp',
  csharp: 'csharp',
  cs: 'csharp',
  'c#': 'csharp',
  cpp: 'cxx',
  'c++': 'cxx',
  cxx: 'cxx',
  swift: 'swift',
}

/** Checkout locations used to refresh the revision-bound cache. */
export const CHECKOUTS = {
  py: '~/work/python/libtmux',
  ruby: '~/work/libtmux/libtmux-ruby-docs',
  lua: '~/work/libtmux/libtmux-lua-docs',
  ts: '~/work/libtmux/libtmux-ts-docs',
  rs: '~/work/libtmux/libtmux-rs-docs',
  go: '~/work/libtmux/libtmux-go-docs',
  java: '~/work/libtmux/libtmux-java-docs',
  // Wrappers quote the parent repository's native, executable examples.
  kotlin: '~/work/libtmux/libtmux-java',
  scala: '~/work/libtmux/libtmux-java',
  fsharp: '~/work/libtmux/libtmux-dotnet',
  csharp: '~/work/libtmux/libtmux-dotnet-docs',
  cxx: '~/work/libtmux/libtmux-cxx-docs',
  swift: '~/work/libtmux/libtmux-swift-docs',
}

export const expand = (p) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)

/** A source-bound CI build supplies its selected checkout through an override. */
export function checkoutFor(owner) {
  const override = process.env[`LIBTMUX_DOCS_CHECKOUT_${owner.toUpperCase()}`]
  return expand(override || CHECKOUTS[owner] || '')
}

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

/** The Markdown twin uses the same prose ownership and source reader as HTML. */
export function resolvePortCode(body, port, authoredPort, link = (href) => href) {
  const out = []
  let fence
  for (const line of resolvePortBody(body, authoredPort || port).split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (!fence && marker && !(marker[1][0] === '`' && marker[2].includes('`'))) {
      const [, language = '', metadata = ''] = /^(\S*)(.*)$/.exec(marker[2].trimStart())
      const owner = LANG_TO_PORT[language.toLowerCase()]
      const dropping = Boolean(port && owner && owner !== port && authoredPort !== port)
      const meta = parseMeta(metadata)
      fence = { marker: marker[1][0], length: marker[1].length, dropping, replaced: Boolean(meta.file && owner) }
      if (dropping) continue
      out.push(line)
      if (fence.replaced) out.push(readFence(owner, meta, 'Markdown export'))
    } else if (
      fence &&
      marker &&
      marker[1][0] === fence.marker &&
      marker[1].length >= fence.length &&
      !marker[2].trim()
    ) {
      if (!fence.dropping) out.push(line)
      fence = undefined
    } else if (!fence?.dropping && !fence?.replaced) {
      out.push(fence ? line : rewriteMarkdownLinks(line, link))
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

/** Rewrite authored destinations while preserving labels and literal inline code. */
export function rewriteMarkdownLinks(text, link) {
  return text
    .replace(/(`+).*?\1|(\]\()(<[^<>\n]*>|[^\s)]+)(?=[\s)])/g, (all, code, prefix, href) =>
      code ? all : `${prefix}${destination(href)}`,
    )
    .replace(/^( {0,3}\[[^\]]+\]:\s*)(<[^<>\n]*>|\S+)/gm, (_all, prefix, href) => `${prefix}${destination(href)}`)
  function destination(href) {
    return href.startsWith('<') && href.endsWith('>') ? `<${link(href.slice(1, -1))}>` : link(href)
  }
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
  const processor = this

  return (tree, file) => {
    const removals = []
    // A language-owned guide may also show its parent's API or build files.
    // Filter alternate examples only in the shared, cross-language prose.
    const authoredPort = file?.data?.astro?.frontmatter?.port
    const raw = String(file?.value ?? '')
    const { body: selected, portAt } = resolvePortContent(raw, authoredPort || port || undefined)
    // Parse the selected source before headings, highlighting or API linking.
    // The Markdown export uses the same selector, including nested regions.
    if (raw !== selected) tree.children = processor.parse(selected).children

    visit(tree, ['inlineCode', 'link', 'linkReference'], (node) => {
      const owner = portAt(node.position?.start.offset ?? -1)
      if (!owner) return
      node.data ??= {}
      node.data.hProperties = { ...node.data.hProperties, dataDocPort: owner }
    })

    visit(tree, 'code', (node, _index, parent) => {
      const lang = (node.lang || '').toLowerCase()
      const owner = LANG_TO_PORT[lang]
      const meta = parseMeta(node.meta)

      if (port && owner && owner !== port && authoredPort !== port) {
        removals.push([parent, node])
        return
      }

      // A fence may name a file in that port's checkout instead of carrying a
      // copy of it. Reading it at build time is what stops a snippet drifting
      // from the code its own repository tests.
      if (meta.file && owner) {
        node.value = readFence(owner, meta, file?.path)
      }
    })

    for (const [parent, node] of removals) {
      const i = parent.children.indexOf(node)
      if (i !== -1) parent.children.splice(i, 1)
    }
  }
}

/**
 * @param {string} owner
 * @param {{ file?: string, region?: string }} meta
 * @param {string} [pagePath]
 * @returns {string}
 */
export function readFence(owner, meta, pagePath) {
  const cached = CACHE[`${owner}:${meta.file}`]
  // Assembly refreshes the cache with git show at the documented revision.
  // Reading a nearby working tree here would silently replace those bytes.
  let source = cached?.content
  if (
    process.env.LIBTMUX_DOCS_PORT === owner &&
    process.env.LIBTMUX_DOCS_SOURCE_SHA &&
    cached?.revision !== process.env.LIBTMUX_DOCS_SOURCE_SHA
  ) {
    throw new Error(`${pagePath ?? 'page'}: ${owner}:${meta.file} does not match the selected source revision`)
  }

  if (source === undefined) {
    // Fail the build rather than ship a silently empty example: a missing
    // tested source is exactly the drift this is meant to catch.
    throw new Error(
      `${pagePath ?? 'page'}: cannot inline ${meta.file} for ${owner} — ` +
        'site/src/data/example-sources.json (run scripts/gen-example-sources.mjs)',
    )
  }

  if (meta.region) {
    const sliced = sliceRegion(source, meta.region)
    if (sliced === null) {
      throw new Error(
        `${pagePath ?? 'page'}: cannot inline ${meta.file} for ${owner} — region "${meta.region}" not found`,
      )
    }
    source = sliced
  }
  return source.replace(/\s+$/, '')
}
