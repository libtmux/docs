#!/usr/bin/env node
/** Stage source-owned port guides from the same native artifact as the API. */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORTS } from '../site/src/lib/ports.ts'
import { sourceGuidesFor, SOURCE_GUIDE_PORTS } from '../site/src/lib/port-documentation.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, 'site/src/content/docs/_staged')
const selectedPort = process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : undefined
const check = process.argv.includes('--check')
const fromSource = process.argv.includes('--from-source')
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

export function rewriteLinks(content, sourcePath, route, routes, repo, revision) {
  const targetUrl = (destination, image = false) => {
    if (external(destination)) return destination
    const [target, fragment = ''] = destination.split('#', 2)
    const normalized = posix.normalize(posix.join(posix.dirname(sourcePath), target))
    const staged = routes[normalized]
    if (staged) {
      let href = posix.relative(route, staged[0]) || '.'
      if (!href.startsWith('.')) href = `./${href}`
      return `${href.replace(/\/$/, '')}/${fragment ? `#${fragment}` : ''}`
    }
    return `https://github.com/${repo}/${image ? 'raw' : 'blob'}/${revision}/${normalized}${fragment ? `#${fragment}` : ''}`
  }
  return content
    .replace(/(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
      (_all, image, label, destination) => `${image}[${label}](${targetUrl(destination, Boolean(image))})`)
    .replace(/^(\[[^\]]+\]:)\s*\n?\s*(\S+)/gm,
      (_all, label, destination) => `${label} ${targetUrl(destination)}`)
}

export function stagedPortGuides(port, artifact) {
  const routes = ROUTES[port]
  const linkRoutes = Object.fromEntries(Object.entries(routes).map(([sourcePath, guide]) => [sourcePath, [guide.route]]))
  const guides = new Map((artifact.guides ?? []).map((guide) => [guide.path, guide.content]))
  const files = new Map()
  for (const [sourcePath, guide] of Object.entries(routes)) {
    const { route, product, package: packageId, domain, aliases, sidebar } = guide
    const content = guides.get(sourcePath)
    if (typeof content !== 'string') throw new Error(`${port}: native artifact is missing guide ${sourcePath}`)
    const { title, body } = titleAndBody(content, sourcePath)
    const rewritten = rewriteLinks(body, sourcePath, route, linkRoutes, artifact.source.repository, artifact.source.revision)
    const data = {
      title,
      description: `Source-owned ${PORTS.find((entry) => entry.slug === port).name} guide at ${artifact.source.revision.slice(0, 12)}.`,
      port,
      ...(product ? { product } : {}),
      ...(packageId ? { package: packageId } : {}),
      ...(domain ? { domain } : {}),
      ...(aliases.length ? { aliases } : {}),
      route,
      source: { repo: artifact.source.repository, path: sourcePath, ref: artifact.source.revision },
      sidebar: sidebar ?? { group: product ? (product === 'mcp' ? 'MCP' : 'Workspace Manager') : route === 'reference' ? 'API reference' : 'Guides' },
    }
    const frontmatter = Object.entries(data).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')
    files.set(`${port}/${route}/index.md`, `---\n${frontmatter}\n---\n\n${rewritten.trim()}\n`)
  }
  const identity = PORTS.find((entry) => entry.slug === port)
  if (identity.parentLibrary) {
    const source = { repo: artifact.source.repository, path: Object.keys(routes)[0], ref: artifact.source.revision }
    const writeIndex = (route, title, body, cards = []) => {
      const data = { title, description: `${title} for ${identity.packageName}.`, port, route, source, cards,
        sidebar: { group: route === 'reference' ? 'API reference' : 'Guides', order: 0 } }
      const frontmatter = Object.entries(data).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')
      files.set(`${port}/${route}/index.md`, `---\n${frontmatter}\n---\n\n${body}\n`)
    }
    const cards = Object.entries(routes).filter(([, entry]) => entry.route.startsWith('guides/'))
      .map(([path, entry]) => ({ label: titleAndBody(guides.get(path), path).title,
        href: `./${entry.route.slice('guides/'.length)}/`, body: `Read the ${identity.name} package guide.` }))
    writeIndex('guides', `${identity.name} guides`,
      `These guides come from the ${identity.packageName} sources at this documentation revision.`, cards)
    if (identity.ecosystemHost) writeIndex('reference', `${identity.name} API reference`,
      `Use the [${identity.ecosystemHost.name} reference](${identity.ecosystemHost.url}) for published package versions.\n\nThe [source at this documentation revision](https://github.com/${source.repo}/tree/${source.ref}/${posix.dirname(source.path)}/src/main) contains the wrapper declarations and their documentation.\n\n${identity.name} and its ${identity.parentLibrary.runtime} core share a release version.`)
  }
  return files
}

function artifactFromSource(port, checkout) {
  const modelPath = join(root, `site/src/data/api/${port.slug}.json`)
  const model = port.parentLibrary ? undefined : JSON.parse(readFileSync(modelPath, 'utf8'))
  const head = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (model && head !== model.revision) {
    throw new Error(`${port.slug}: checkout ${head} differs from integrated model ${model.revision}`)
  }
  return {
    source: { repository: port.repo, revision: head },
    guides: Object.keys(ROUTES[port.slug]).map((path) => ({
      path,
      content: readFileSync(join(checkout, path), 'utf8'),
    })),
  }
}

export function run() {
  if (selectedPort && !(selectedPort in ROUTES)) throw new Error(`unsupported staged port: ${selectedPort}`)
  const generated = new Map()
  const selected = PORTS.filter((entry) => entry.slug in ROUTES && (!selectedPort || entry.slug === selectedPort) && (!wrappersOnly || entry.parentLibrary))
  if (refreshCache && (!selectedPort || !selected[0]?.parentLibrary)) throw new Error('--refresh-cache requires one wrapper --port')
  for (const port of selected) {
    const checkout = expand(process.env[`LIBTMUX_DOCS_CHECKOUT_${port.slug.toUpperCase()}`] || port.worktree)
    const artifactPath = join(checkout, 'docs/_build/api.json')
    const selectedSource = process.env.LIBTMUX_DOCS_PORT === port.slug && process.env.LIBTMUX_DOCS_SOURCE_SHA
    const cachePath = join(cacheRoot, `${port.slug}.json`)
    const liveWrapper = port.parentLibrary && (refreshCache || selectedSource || (selectedPort && fromSource))
    if (!port.parentLibrary && !fromSource && !existsSync(artifactPath)) throw new Error(`${port.slug}: native artifact missing at ${artifactPath}`)
    const artifact = port.parentLibrary && !liveWrapper
      ? JSON.parse(readFileSync(cachePath, 'utf8'))
      : fromSource || liveWrapper ? artifactFromSource(port, checkout)
      : JSON.parse(readFileSync(artifactPath, 'utf8'))
    if (artifact.source.repository !== port.repo || !/^[a-f0-9]{40}$/.test(artifact.source.revision)) {
      throw new Error(`${port.slug}: invalid source guide provenance`)
    }
    const expected = selectedSource
    if (expected && artifact.source?.revision !== expected) {
      throw new Error(`${port.slug}: expected source ${expected}, artifact records ${artifact.source?.revision}`)
    }
    if (port.parentLibrary && !check && (refreshCache || selectedSource)) {
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
