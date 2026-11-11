#!/usr/bin/env node
/** Stage source-owned port guides from the same native artifact as the API. */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { toMarkdown } from 'mdast-util-to-markdown'
import { PORTS } from '../site/src/lib/ports.ts'
import { defaultVersionFor, linkedVersionFor } from '../site/src/lib/versions.ts'
import { sourceGuidesFor, sourceGuideRedirectsFor, stagedSectionsFor, stagedSectionDescription, SOURCE_GUIDE_PORTS } from '../site/src/lib/port-documentation.ts'
import { SymbolIndex, parameterId } from '../packages/api-model/src/link.ts'
import { BADGE_DIRECTORY, badgesStale, localizeBadges } from './lib/badges.mjs'
import { resolveCheckout } from './lib/port-checkout.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, 'site/src/content/docs/_staged')
// Badge SVGs are content-hashed, so every build publishes the same bytes at the same path.
const badgeOutput = join(root, 'site/public', BADGE_DIRECTORY)
const selectedPort = process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : undefined
const check = process.argv.includes('--check')
const fromSource = process.argv.includes('--from-source')
const integrated = process.argv.includes('--integrated')
const cached = process.argv.includes('--cached')
const wrappersOnly = process.argv.includes('--wrappers')
const refreshCache = process.argv.includes('--refresh-cache')
const cacheRoot = join(root, 'site/src/data/port-guides')

/** Source-path lookup used for staging and source-relative link rewriting. */
export function stagedRoutesFor(port) {
  return Object.fromEntries(sourceGuidesFor(port).map((entry) => [entry.sourcePath, entry]))
}

const ROUTES = Object.fromEntries(SOURCE_GUIDE_PORTS.map((slug) => [slug, stagedRoutesFor(slug)]))


function titleAndBody(content, sourcePath) {
  // The shared catalog supplies page metadata; source frontmatter is not article prose.
  content = content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
  content = content.replace(/<!-- libtmux-logo -->[\s\S]*?<!-- \/libtmux-logo -->\s*/g, '')
  // GitHub README headers may center the title and intro in a presentation
  // wrapper. The site supplies its own heading; later HTML stays intact.
  const centered = /^<div align=["']center["']>\s*\n([\s\S]*?)\n<\/div>\s*/.exec(content)
  if (centered && /^#\s/.test(centered[1])) {
    content = `${centered[1]}\n\n${content.slice(centered[0].length)}`
  }
  const match = /^#\s+(.+)\n+/.exec(content)
  return {
    title: match?.[1]?.trim() ?? posix.basename(sourcePath, '.md'),
    body: match ? content.slice(match[0].length) : content,
  }
}

/**
 * The first sentence of a guide's opening prose as plain text, or an empty
 * string when the guide opens with code, a table or a list, or its first
 * sentence is longer than `limit`. Staged pages use it where the catalog
 * gives no description.
 */
export function leadSentence(body, limit = 240) {
  const text = (node) => node.type === 'text' || node.type === 'inlineCode' ? node.value
    : node.type === 'image' || node.type === 'html' ? '' : (node.children ?? []).map(text).join('')
  for (const node of fromMarkdown(body).children) {
    if (node.type === 'heading' || node.type === 'html') continue
    if (node.type !== 'paragraph') return ''
    const plain = text(node).replace(/\s+/g, ' ').trim()
    if (!plain) continue
    const sentence = /^(.+?[.!?])(?:\s|$)/.exec(plain)?.[1] ?? plain
    return sentence.length <= limit && !sentence.endsWith(':') ? sentence : ''
  }
  return ''
}

function external(value) {
  return /^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(value)
}

export function rewriteLinks(content, sourcePath, route, routes, repo, revision, nativeReferenceFiles = new Set(), nativeDeclarations = new Map()) {
  const targetUrl = (destination, image = false, label) => {
    const owned = !image && /^https?:\/\/libtmux\.org\/en\/([^/]+)\//.exec(destination)
    if (owned) {
      const port = owned[1] === 'dotnet' ? 'csharp' : owned[1]
      if (PORTS.some((entry) => entry.slug === port)) return destination.replace(owned[0], `/${port}/`)
    }
    const ownSource = `https://github.com/${repo}/blob/`
    if (!image && destination.startsWith(ownSource)) {
      const [ref, ...path] = destination.slice(ownSource.length).split('/')
      const [target, fragment = ''] = path.join('/').split('#', 2)
      if (['master', 'main', revision].includes(ref)) {
        destination = `${posix.relative(posix.dirname(sourcePath), target)}${fragment ? `#${fragment}` : ''}`
      }
    }
    if (external(destination)) return destination
    const [target, fragment = ''] = destination.split('#', 2)
    const normalized = posix.normalize(posix.join(posix.dirname(sourcePath), target))
    const memberRoute = fragment && routes[`${normalized}#${fragment}`]
    const declaration = !fragment && label && nativeDeclarations.get(`${normalized}\0${label}`)
    // Unknown native-help sections keep their source destination rather than
    // acquiring a fragment that the shared reference does not render.
    const staged = memberRoute || declaration || (fragment && nativeReferenceFiles.has(normalized) ? undefined : routes[normalized])
    if (staged) {
      let href = posix.relative(route, staged[0]) || '.'
      if (!href.startsWith('.')) href = `./${href}`
      const anchor = staged[1] || (!memberRoute ? fragment : '')
      return `${href.replace(/\/$/, '')}/${anchor ? `#${anchor}` : ''}`
    }
    return `https://github.com/${repo}/${image ? 'raw' : 'blob'}/${revision}/${normalized}${fragment ? `#${fragment}` : ''}`
  }
  // Scala calls such as resource[IO](config) look like Markdown links.
  // Parse first so code remains byte-for-byte source-owned, then replace
  // only real links; the rest of the guide keeps its authored formatting.
  const editsFor = (node) => {
    const children = (node.children ?? []).flatMap(editsFor)
    if (!['link', 'image', 'definition'].includes(node.type)) return children
    const label = node.type === 'link' && node.children.every((child) => ['text', 'inlineCode'].includes(child.type))
      ? node.children.map((child) => child.value).join('') : undefined
    const url = targetUrl(node.url, node.type === 'image', label)
    if (url === node.url) return children
    node.url = url
    return [{ start: node.position.start.offset, end: node.position.end.offset,
      text: toMarkdown(node).trimEnd() }]
  }
  const edits = editsFor(fromMarkdown(content)).sort((a, b) => b.start - a.start)
  for (const { start, end, text } of edits) content = content.slice(0, start) + text + content.slice(end)
  return content
}

/** Descriptor depth labels name .NET enum constants, not F# object properties. */
export function linkSnapshotDepths(content, symbols, referenceRoot) {
  const edits = []
  const visit = (node) => {
    const paragraph = node.type === 'listItem' && node.children.length === 1 ? node.children[0] : undefined
    const children = paragraph?.type === 'paragraph' ? paragraph.children : []
    if (children.length === 2 && children[0].type === 'text' && children[0].value === 'Required depth: '
        && children[1].type === 'inlineCode') {
      symbols ??= JSON.parse(readFileSync(join(root, 'site/src/data/api/csharp.json'), 'utf8')).symbols
      // The Markdown pipeline adds the locale and preview mount once.
      referenceRoot ??= `/csharp/${defaultVersionFor('csharp')}/reference/`
      const label = children[1]
      const id = `LibTmux.SnapshotDepth.${label.value}`
      const matches = symbols.filter((symbol) => (symbol.publicId ?? symbol.id) === id)
      if (matches.length !== 1 || matches[0].parent !== 'LibTmux.SnapshotDepth'
          || matches[0].kind !== 'constant' || matches[0].product !== 'core' || !matches[0].slug) {
        throw new Error(`F# descriptor depth must resolve to one public .NET enum constant: ${id}`)
      }
      const { start, end } = label.position
      edits.push({ start: start.offset, end: end.offset,
        text: `[${content.slice(start.offset, end.offset)}](${referenceRoot}${matches[0].slug}/)` })
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(fromMarkdown(content))
  for (const { start, end, text } of edits.sort((a, b) => b.start - a.start)) {
    content = content.slice(0, start) + text + content.slice(end)
  }
  return content
}

/** Native reference file for each public Common Lisp package. */
export const LISP_REFERENCE_FILES = {
  libtmux: 'docs/api.md',
  'libtmux.control': 'docs/control-api.md',
  'libtmux.query': 'docs/query-api.md',
  'libtmux.json': 'docs/json-api.md',
  'libtmux.workspace': 'docs/workspace-api.md',
  'libtmux.workspace.cli': 'docs/workspace-api.md',
}

/**
 * Source-guide link routes for Common Lisp declarations. A declaration whose
 * package has no entry in LISP_REFERENCE_FILES throws: the port's own build
 * regenerates the model at its head, which can name a package added since.
 */
export function lispReferenceRoutes(symbols) {
  const routes = {}
  for (const symbol of symbols.filter((entry) => entry.kind !== 'module')) {
    const file = LISP_REFERENCE_FILES[symbol.namespace]
    if (!file) throw new Error(`Common Lisp declaration has no native reference: ${symbol.id}`)
    const anchor = `${symbol.name}-${symbol.kind === 'function' ? 'function' : 'type'}`
    routes[`${file}#${anchor}`] = [`${symbol.product === 'workspace' ? 'workspace/' : ''}reference/${symbol.slug}`]
  }
  return routes
}

export function stagedPortGuides(port, artifact) {
  const identity = PORTS.find((entry) => entry.slug === port)
  const routes = ROUTES[port]
  const linkRoutes = Object.fromEntries(Object.entries(routes).map(([sourcePath, guide]) => [sourcePath, [guide.route]]))
  const nativeReferenceFiles = new Set()
  const nativeDeclarations = new Map()
  for (const redirect of sourceGuideRedirectsFor(port)) linkRoutes[redirect.sourcePath] = [redirect.target]
  if (port === 'haskell') {
    const model = JSON.parse(readFileSync(join(root, 'site/src/data/api/haskell.json'), 'utf8'))
    if (model.revision !== artifact.source.revision) throw new Error('haskell: guide source differs from the Haskell API model')
    for (const symbol of model.symbols.filter((entry) => entry.kind === 'module' && entry.apiScope !== 'internal' && (entry.product ?? 'core') === 'core')) {
      if (symbol.source?.file) {
        linkRoutes[symbol.source.file] = [`reference/${symbol.slug}`]
        nativeReferenceFiles.add(symbol.source.file)
        const names = Map.groupBy(model.symbols.filter((entry) => entry.kind !== 'module'
          && (entry.namespace === symbol.id || entry.parent === symbol.id)
          && entry.apiScope !== 'internal' && (entry.product ?? 'core') === 'core'), (entry) => entry.name)
        for (const [name, declarations] of names) {
          // A shared type/constructor spelling selects the data head.
          // Repeated record labels stay at the module.
          const heads = declarations.filter((entry) => entry.kind === 'typealias')
          const selected = heads.length === 1 ? heads[0] : declarations.length === 1 ? declarations[0] : undefined
          if (selected?.slug) nativeDeclarations.set(`${symbol.source.file}\0${name}`, [`reference/${selected.slug}`])
        }
      }
    }
  }
  if (identity.sourceReferenceFiles) {
    const { symbols } = JSON.parse(readFileSync(join(root, `site/src/data/api/${port}.json`), 'utf8'))
    for (const { file, package: coordinate } of identity.sourceReferenceFiles) {
      nativeReferenceFiles.add(file)
      for (const symbol of symbols.filter((entry) => entry.package === coordinate)) {
        const fragment = (symbol.publicId ?? symbol.id).toLowerCase().replace(/[^\w-]/g, '')
        linkRoutes[`${file}#${fragment}`] = [`reference/${symbol.slug}`]
      }
    }
  }
  if (port === 'lisp') {
    const { symbols } = JSON.parse(readFileSync(join(root, 'site/src/data/api/lisp.json'), 'utf8'))
    Object.assign(linkRoutes, lispReferenceRoutes(symbols))
    for (const symbol of symbols.filter((entry) => entry.kind !== 'module')) nativeReferenceFiles.add(LISP_REFERENCE_FILES[symbol.namespace])
  }
  if (port === 'powershell') {
    const model = JSON.parse(readFileSync(join(root, 'site/src/data/api/powershell.json'), 'utf8'))
    const files = new Set(model.nativeProvenance.files.map((file) => file.path))
    for (const symbol of model.symbols.filter((entry) => entry.command)) {
      const help = `docs/reference/${symbol.namespace}/${symbol.name}.md`
      if (!files.has(help)) throw new Error(`PowerShell command help is absent from native provenance: ${help}`)
      const reference = `${symbol.product === 'workspace' ? 'workspace/' : ''}reference/${symbol.slug}`
      linkRoutes[help] = [reference]
      nativeReferenceFiles.add(help)
      for (const parameter of symbol.signatures.flatMap((signature) => signature.params)) {
        if (parameter.binding?.common) continue
        linkRoutes[`${help}#-${parameter.name.toLowerCase()}`] = [reference, encodeURIComponent(parameterId(symbol, parameter.name))]
      }
    }
  }
  if (identity.sourceReferenceDirectory) {
    const { symbols } = JSON.parse(readFileSync(join(root, `site/src/data/api/${port}.json`), 'utf8'))
    const byId = new Map(symbols.map((symbol) => [symbol.id, symbol]))
    const directory = identity.sourceReferenceDirectory
    linkRoutes[`${directory}/index.md`] = ['reference']
    for (const symbol of symbols) {
      linkRoutes[`${directory}/${symbol.slug}.md`] = [`reference/${symbol.slug}`]
      const parent = byId.get(symbol.parent)
      if (parent) linkRoutes[`${directory}/${parent.slug}.md#${symbol.name}`] = [`reference/${symbol.slug}`]
    }
  }
  const guides = new Map((artifact.guides ?? []).map((guide) => [guide.path, guide.content]))
  const files = new Map()
  const descriptions = new Map()
  for (const [sourcePath, guide] of Object.entries(routes)) {
    const { route, product, package: packageId, domain, aliases, equivalence, sidebar } = guide
    const content = guides.get(sourcePath)
    if (typeof content !== 'string') throw new Error(`${port}: native artifact is missing guide ${sourcePath}`)
    const { title: sourceTitle, body } = titleAndBody(content, sourcePath)
    const title = guide.title ?? sourceTitle
    const linked = port === 'fsharp' && sourcePath === 'docs/fsharp/supported-query-fields.md'
      ? linkSnapshotDepths(body) : body
    const nativeLinked = port === 'julia' ? linkDocumenter(linked, artifact.source) : linked
    const { content: badged, files: badgeFiles } = localizeBadges(nativeLinked, port)
    for (const [name, svg] of badgeFiles) files.set(name, svg)
    const rewritten = rewriteLinks(badged, sourcePath, route, linkRoutes, artifact.source.repository, artifact.source.revision, nativeReferenceFiles, nativeDeclarations)
    const data = {
      title,
      description: guide.description ?? (leadSentence(rewritten) || `${title} guide for ${identity.packageName}.`),
      port,
      ...(product ? { product } : {}),
      ...(packageId ? { package: packageId } : {}),
      ...(domain ? { domain } : {}),
      ...(aliases.length ? { aliases } : {}),
      ...(equivalence ? { equivalence } : {}),
      route,
      source: { repo: artifact.source.repository, path: sourcePath, ref: artifact.source.revision },
      sidebar: sidebar ?? { group: product ? (product === 'mcp' ? 'MCP' : 'Workspace Manager')
        : route === 'reference' ? 'API reference' : route.split('/')[0].replace(/^./, (letter) => letter.toUpperCase()) },
    }
    descriptions.set(sourcePath, data.description)
    const frontmatter = Object.entries(data).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')
    files.set(`${port}/${route}/index.md`, `---\n${frontmatter}\n---\n\n${rewritten.trim()}\n`)
  }
  {
    const source = { repo: artifact.source.repository, path: Object.keys(routes)[0], ref: artifact.source.revision }
    const writeIndex = (route, title, body, cards = []) => {
      const data = { title, description: leadSentence(body) || `${title} for ${identity.packageName}.`, port, route, source, cards,
        sidebar: { group: route === 'reference' ? 'API reference' : route[0].toUpperCase() + route.slice(1), label: 'Overview', order: 1 } }
      const frontmatter = Object.entries(data).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')
      files.set(`${port}/${route}/index.md`, `---\n${frontmatter}\n---\n\n${body}\n`)
    }
    for (const section of stagedSectionsFor(port)) {
      // Authored overviews own their cards and must keep one public route.
      if (existsSync(join(root, `site/src/content/docs/ports/${port}/${section}/index.md`))) continue
      const selected = Object.entries(routes).filter(([, entry]) => entry.domain === 'core' && entry.route.startsWith(`${section}/`))
      const cards = selected.map(([path, entry]) => ({ label: entry.title ?? titleAndBody(guides.get(path), path).title,
        href: `../${entry.route}/`, body: descriptions.get(path),
        order: entry.sidebar?.order ?? Number.MAX_SAFE_INTEGER }))
        .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
        .map(({ order: _order, ...card }) => card)
      if (section === 'guides' && existsSync(join(root, `site/src/content/docs/ports/${port}/guides/attaching-to-tmux.md`))) cards.splice(Math.min(1, cards.length), 0, {
        label: 'Attaching to tmux', href: '../guides/attaching-to-tmux/',
        body: 'Connect to an existing socket and leave its server running.',
      })
      if (section === 'examples' && existsSync(join(root, `site/src/content/docs/ports/${port}/examples/capture-pane-output.md`))) cards.unshift({
        label: 'Capture pane output', href: '../examples/capture-pane-output/',
        body: 'Send a command, wait for its output, and clean up the private server.',
      })
      writeIndex(section, section[0].toUpperCase() + section.slice(1), stagedSectionDescription(port, section), cards)
    }
    if (identity.referenceKind === 'guide' && identity.ecosystemHost) writeIndex('reference', `${identity.name} API reference`,
      `Use the [${identity.ecosystemHost.name} reference](${identity.ecosystemHost.url}) for published package versions.\n\nThe [source at this documentation revision](https://github.com/${source.repo}/tree/${source.ref}/${posix.dirname(source.path)}/src/main) contains the wrapper declarations and their documentation.\n\n${identity.name} and its ${identity.parentLibrary.runtime} core share a release version.`)
  }
  return files
}

function artifactFromSource(port, checkout) {
  const modelPath = join(root, `site/src/data/api/${port.slug}.json`)
  const model = port.parentLibrary ? undefined : JSON.parse(readFileSync(modelPath, 'utf8'))
  const revision = model?.revision ?? execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  return artifactFromRevision(port, checkout, revision)
}

/** Expand the native manual's literal source includes without evaluating Julia. */
export function expandDocumenter(content, sourcePath, readSource) {
  return content.replace(/^```jldoctest(?:[^\n]*)$/gm, '```julia').replace(/^```@(eval|autodocs)\n([\s\S]*?)^```/gm, (_block, directive, code) => {
    if (directive === 'autodocs') {
      const module = /Modules = \[(LibTmux(?:MCP|Workspace)?)\]/.exec(code)?.[1]
      if (!module) throw new Error(`Unsupported Documenter module in ${sourcePath}`)
      const product = module === 'LibTmuxMCP' ? 'mcp/' : module === 'LibTmuxWorkspace' ? 'workspace/' : ''
      return `Browse the [${module} API reference](/julia/${linkedVersionFor('julia')}/${product}reference/).`
    }
    const match = /^using Markdown\s+Markdown\.parse\("```julia\\n" \* read\(joinpath\(@__DIR__, ((?:"[^"\n]+"(?:, )?)+)\), String\) \* "\\n```"\)\s*$/.exec(code)
    if (!match) throw new Error(`Unsupported Documenter source include in ${sourcePath}`)
    const parts = [...match[1].matchAll(/"([^"\n]+)"/g)].map((entry) => entry[1])
    const file = posix.normalize(posix.join(posix.dirname(sourcePath), ...parts))
    if (file.startsWith('../') || posix.isAbsolute(file)) throw new Error(`Documenter include escapes its checkout: ${file}`)
    const source = readSource(file)
    const fence = '`'.repeat(Math.max(3, ...[...source.matchAll(/`+/g)].map((entry) => entry[0].length + 1)))
    return `${fence}julia title="${posix.basename(file)}"\n${source.trimEnd()}\n${fence}`
  })
}

/** Resolve Documenter references against the same catalog the site renders. */
function linkDocumenter(content, source) {
  const model = JSON.parse(readFileSync(join(root, 'site/src/data/api/julia.json'), 'utf8'))
  const index = new SymbolIndex(model.symbols, (symbol) =>
    `/julia/${linkedVersionFor('julia')}/${symbol.product && symbol.product !== 'core' ? `${symbol.product}/` : ''}reference/${symbol.slug}/`, 'julia')
  const edits = []
  const walk = (node) => {
    if (node.type === 'code' && node.lang === '@raw' && node.meta === 'html') {
      const html = node.value.replace(/(\bhref\s*=\s*)(["'])\.\.\/source\/([^"'#]+)\.html(#[^"']*)?\2/g,
        (_link, attribute, quote, path, fragment = '') =>
          `${attribute}${quote}https://github.com/${source.repository}/blob/${source.revision}/${path}${fragment}${quote}`)
      edits.push({ start: node.position.start.offset, end: node.position.end.offset, text: html })
    } else if (node.type === 'link' && node.url === '@ref') {
      const target = node.children.map((child) => child.value ?? '').join('')
      const match = index.resolve(target)
      if (!match) throw new Error(`Unresolved Julia guide reference: ${target}`)
      node.url = match.href
      edits.push({ start: node.position.start.offset, end: node.position.end.offset, text: toMarkdown(node).trimEnd() })
    } else for (const child of node.children ?? []) walk(child)
  }
  walk(fromMarkdown(content))
  for (const edit of edits.sort((a, b) => b.start - a.start)) content = content.slice(0, edit.start) + edit.text + content.slice(edit.end)
  return content
}

/** Read the integrated commit even when a contributor's working tree has advanced. */
export function artifactFromRevision(port, checkout, revision) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error(`${port.slug}: invalid integrated source revision`)
  const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', stdio: 'pipe' })
  try {
    git('cat-file', '-e', `${revision}^{commit}`)
  } catch (cause) {
    throw new Error(`${port.slug}: integrated guides need ${port.repo}@${revision} in ${checkout}. Set LIBTMUX_DOCS_CHECKOUT_${port.slug.toUpperCase()} to a local checkout containing that commit; this check does not fetch.`, { cause })
  }
  const paths = Object.keys(ROUTES[port.slug])
  const blobs = execFileSync('git', ['-C', checkout, 'cat-file', '--batch'], {
    input: paths.map((path) => `${revision}:${path}\n`).join(''), maxBuffer: 16 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const contents = new Map()
  let offset = 0
  for (const path of paths) {
    const end = blobs.indexOf(10, offset)
    const header = blobs.subarray(offset, end).toString('ascii')
    const match = /^[a-f0-9]{40} blob (\d+)$/.exec(header)
    const size = match && Number(match[1])
    if (end < offset || size === null || !Number.isSafeInteger(size) || size < 0 ||
        end + size + 1 >= blobs.length || blobs[end + size + 1] !== 10) {
      throw new Error(`${port.slug}: missing or malformed integrated guide ${revision}:${path}`)
    }
    contents.set(path, blobs.subarray(end + 1, end + size + 1).toString('utf8'))
    offset = end + size + 2
  }
  if (offset !== blobs.length) throw new Error(`${port.slug}: unexpected trailing Git blob data`)
  const readSource = (file) => contents.get(file) ?? git('show', `${revision}:${file}`)
  return {
    source: { repository: port.repo, revision },
    guides: paths.map((path) => {
      const content = readSource(path)
      return { path, content: port.slug === 'julia' ? expandDocumenter(content, path, readSource) : content }
    }),
  }
}

export function run() {
  if (selectedPort && !(selectedPort in ROUTES)) throw new Error(`unsupported staged port: ${selectedPort}`)
  if (integrated && (fromSource || refreshCache || process.env.LIBTMUX_DOCS_SOURCE_SHA)) {
    throw new Error('--integrated cannot replace selected-source publication inputs')
  }
  const publicationPort = process.env.LIBTMUX_DOCS_SOURCE_SHA && process.env.LIBTMUX_DOCS_PORT
  if (cached && selectedPort && selectedPort === publicationPort) {
    throw new Error(`--cached cannot stage selected publication port ${selectedPort}; regenerate its source guides first`)
  }
  const generated = new Map()
  const selected = PORTS.filter((entry) => entry.slug in ROUTES && (!selectedPort || entry.slug === selectedPort)
    && (!wrappersOnly || entry.parentLibrary) && !(cached && entry.slug === publicationPort))
  if (refreshCache && !selectedPort) throw new Error('--refresh-cache requires one --port')
  for (const port of selected) {
    const checkout = resolveCheckout(port, { order: [integrated ? 'checkout' : 'worktree'] })
    const artifactPath = join(checkout, 'docs/_build/api.json')
    const selectedSource = process.env.LIBTMUX_DOCS_PORT === port.slug && process.env.LIBTMUX_DOCS_SOURCE_SHA
    const cachePath = join(cacheRoot, `${port.slug}.json`)
    const liveWrapper = port.parentLibrary && (refreshCache || selectedSource || (selectedPort && fromSource))
    if (!cached && !port.parentLibrary && !fromSource && !integrated && !existsSync(artifactPath)) throw new Error(`${port.slug}: native artifact missing at ${artifactPath}`)
    const artifact = cached || (port.parentLibrary && !liveWrapper)
      ? JSON.parse(readFileSync(cachePath, 'utf8'))
      : integrated ? artifactFromRevision(port, checkout, JSON.parse(readFileSync(join(root, `site/src/data/api/${port.slug}.json`), 'utf8')).revision)
      : fromSource || liveWrapper ? artifactFromSource(port, checkout)
      : JSON.parse(readFileSync(artifactPath, 'utf8'))
    if (artifact.source.repository !== port.repo || !/^[a-f0-9]{40}$/.test(artifact.source.revision)) {
      throw new Error(`${port.slug}: invalid source guide provenance`)
    }
    if (!port.parentLibrary) {
      const model = JSON.parse(readFileSync(join(root, `site/src/data/api/${port.slug}.json`), 'utf8'))
      if (artifact.source.revision !== model.revision) throw new Error(`${port.slug}: guide source ${artifact.source.revision} differs from integrated model ${model.revision}`)
    }
    const expected = selectedSource
    if (expected && artifact.source?.revision !== expected) {
      throw new Error(`${port.slug}: expected source ${expected}, artifact records ${artifact.source?.revision}`)
    }
    if (!check && (refreshCache || selectedSource)) {
      mkdirSync(cacheRoot, { recursive: true })
      const content = `${JSON.stringify(artifact, null, 2)}\n`
      if (!existsSync(cachePath) || readFileSync(cachePath, 'utf8') !== content) writeFileSync(cachePath, content)
    }
    for (const [file, content] of stagedPortGuides(port.slug, artifact)) generated.set(file, content)
  }

  const actual = new Map()
  const allOutputs = !check && !selectedPort && !wrappersOnly
  const walk = (directory, prefix = '') => {
    if (!existsSync(directory)) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = posix.join(prefix, entry.name)
      if (entry.isDirectory()) walk(join(directory, entry.name), relative)
      else if (allOutputs || selected.some((port) => relative.startsWith(`${port.slug}/`))) {
        actual.set(relative, readFileSync(join(directory, entry.name), 'utf8'))
      }
    }
  }
  walk(output)
  if (check) {
    const isBadge = (file) => file.startsWith(`${BADGE_DIRECTORY}/`)
    const guides = [...generated].filter(([file]) => !isBadge(file))
    const badgeStale = badgesStale(generated, badgeOutput)
    const stale = badgeStale || guides.length !== actual.size || guides.some(([file, content]) => actual.get(file) !== content)
    if (stale) throw new Error('staged port guides are missing or stale; rerun without --check')
  } else {
    for (const file of actual.keys()) if (!generated.has(file)) rmSync(join(output, file), { force: true })
    if (allOutputs) rmSync(badgeOutput, { recursive: true, force: true })
    for (const [file, content] of generated) {
      if (actual.get(file) === content) continue
      const destination = file.startsWith(`${BADGE_DIRECTORY}/`) ? join(badgeOutput, posix.basename(file)) : join(output, file)
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(destination, content)
    }
  }

  console.log(`stage-port-docs: ${[...generated.keys()].filter((file) => !file.startsWith(`${BADGE_DIRECTORY}/`)).length} guides from ${selected.map((port) => port.slug).join(',')}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run()
