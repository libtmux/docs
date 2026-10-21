#!/usr/bin/env node
/** Stage source-owned port guides from the same native artifact as the API. */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { toMarkdown } from 'mdast-util-to-markdown'
import { PORTS } from '../site/src/lib/ports.ts'
import { defaultVersionFor, linkedVersionFor } from '../site/src/lib/versions.ts'
import { sourceGuidesFor, sourceGuideRedirectsFor, SOURCE_GUIDE_PORTS } from '../site/src/lib/port-documentation.ts'
import { SymbolIndex, parameterId } from '../packages/api-model/src/link.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, 'site/src/content/docs/_staged')
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

const expand = (value) => value.startsWith('~/') ? join(homedir(), value.slice(2)) : value

function titleAndBody(content, sourcePath) {
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

function external(value) {
  return /^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(value)
}

export function rewriteLinks(content, sourcePath, route, routes, repo, revision, nativeReferenceFiles = new Set()) {
  const targetUrl = (destination, image = false) => {
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
    // Unknown native-help sections keep their source destination rather than
    // acquiring a fragment that the shared reference does not render.
    const staged = memberRoute || (fragment && nativeReferenceFiles.has(normalized) ? undefined : routes[normalized])
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
    const url = targetUrl(node.url, node.type === 'image')
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

export function stagedPortGuides(port, artifact) {
  const identity = PORTS.find((entry) => entry.slug === port)
  const routes = ROUTES[port]
  const linkRoutes = Object.fromEntries(Object.entries(routes).map(([sourcePath, guide]) => [sourcePath, [guide.route]]))
  const nativeReferenceFiles = new Set()
  for (const redirect of sourceGuideRedirectsFor(port)) linkRoutes[redirect.sourcePath] = [redirect.target]
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
  for (const [sourcePath, guide] of Object.entries(routes)) {
    const { route, product, package: packageId, domain, aliases, equivalence, sidebar } = guide
    const content = guides.get(sourcePath)
    if (typeof content !== 'string') throw new Error(`${port}: native artifact is missing guide ${sourcePath}`)
    const { title: sourceTitle, body } = titleAndBody(content, sourcePath)
    const title = guide.title ?? sourceTitle
    const linked = port === 'fsharp' && sourcePath === 'docs/fsharp/supported-query-fields.md'
      ? linkSnapshotDepths(body) : body
    const nativeLinked = port === 'julia' ? linkDocumenter(linked, artifact.source) : linked
    const rewritten = rewriteLinks(nativeLinked, sourcePath, route, linkRoutes, artifact.source.repository, artifact.source.revision, nativeReferenceFiles)
    const data = {
      title,
      description: guide.description ?? `${title}: ${identity.packageName} documentation.`,
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
    const frontmatter = Object.entries(data).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')
    files.set(`${port}/${route}/index.md`, `---\n${frontmatter}\n---\n\n${rewritten.trim()}\n`)
  }
  {
    const source = { repo: artifact.source.repository, path: Object.keys(routes)[0], ref: artifact.source.revision }
    const writeIndex = (route, title, body, cards = []) => {
      const data = { title, description: `${title} for ${identity.packageName}.`, port, route, source, cards,
        sidebar: { group: route === 'reference' ? 'API reference' : route[0].toUpperCase() + route.slice(1), label: 'Overview', order: 1 } }
      const frontmatter = Object.entries(data).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')
      files.set(`${port}/${route}/index.md`, `---\n${frontmatter}\n---\n\n${body}\n`)
    }
    for (const section of identity.parentLibrary ? ['guides'] : ['guides', 'examples', 'topics', 'concepts']) {
      // Authored overviews own their cards and must keep one public route.
      if (existsSync(join(root, `site/src/content/docs/ports/${port}/${section}/index.md`))) continue
      const selected = Object.entries(routes).filter(([, entry]) => entry.domain === 'core' && entry.route.startsWith(`${section}/`))
      const cards = selected.map(([path, entry]) => ({ label: entry.title ?? titleAndBody(guides.get(path), path).title,
        href: `../${entry.route}/`, body: entry.description ?? `Read about ${titleAndBody(guides.get(path), path).title.toLowerCase()}.`,
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
      writeIndex(section, section[0].toUpperCase() + section.slice(1),
        { guides: 'Connect to tmux and work with its sessions, windows, and panes.',
          examples: 'Run complete programs with their documented setup and cleanup.',
          topics: 'Understand object ownership, state, and operation behavior.',
          concepts: 'Understand captured queries, object identities, and operations.' }[section], cards)
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
  return {
    source: { repository: port.repo, revision },
    guides: Object.keys(ROUTES[port.slug]).map((path) => {
      const readSource = (file) => git('show', `${revision}:${file}`)
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
    const checkout = expand(process.env[`LIBTMUX_DOCS_CHECKOUT_${port.slug.toUpperCase()}`] || (integrated ? port.checkout : port.worktree))
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
      writeFileSync(cachePath, `${JSON.stringify(artifact, null, 2)}\n`)
    }
    for (const [file, content] of stagedPortGuides(port.slug, artifact)) generated.set(file, content)
  }

  if (check) {
    const actual = new Map()
    const walk = (directory, prefix = '') => {
      if (!existsSync(directory)) return
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const relative = posix.join(prefix, entry.name)
        if (entry.isDirectory()) walk(join(directory, entry.name), relative)
        else if (selected.some((port) => relative.startsWith(`${port.slug}/`))) actual.set(relative, readFileSync(join(directory, entry.name), 'utf8'))
      }
    }
    walk(output)
    const stale = generated.size !== actual.size || [...generated].some(([file, content]) => actual.get(file) !== content)
    if (stale) throw new Error('staged port guides are missing or stale; rerun without --check')
  } else {
    if (selectedPort || wrappersOnly) {
      for (const port of selected) rmSync(join(output, port.slug), { recursive: true, force: true })
    } else rmSync(output, { recursive: true, force: true })
    for (const [file, content] of generated) {
      const destination = join(output, file)
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(destination, content)
    }
  }

  console.log(`stage-port-docs: ${generated.size} guides from ${selected.map((port) => port.slug).join(',')}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run()
