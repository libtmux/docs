#!/usr/bin/env node
/** Stage source-owned port guides from the same native artifact as the API. */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORTS } from '../site/src/lib/ports.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, 'site/src/content/docs/_staged')
const selectedPort = process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : undefined
const check = process.argv.includes('--check')
const fromSource = process.argv.includes('--from-source')

const ROUTES = {
  ruby: {
    'README.md': ['guides/source/overview'],
    'docs/modes.md': ['guides/source/execution-modes'],
    'docs/ownership-errors.md': ['guides/source/ownership-errors'],
    'docs/recipes.md': ['examples/source-recipes'],
    'gems/libtmux/README.md': ['guides/source/core'],
    'gems/libtmux-async/README.md': ['guides/source/async'],
    'gems/libtmux-mcp/README.md': ['mcp/source-guide', 'mcp'],
    'gems/libtmux-workspace/README.md': ['workspace/source-guide', 'workspace'],
  },
  lua: {
    'README.md': ['guides/source/overview'],
    'docs/runtime.md': ['guides/source/runtime'],
    'docs/query.md': ['guides/source/query'],
    'docs/snapshots.md': ['guides/source/snapshots'],
    'docs/creation.md': ['guides/source/creation'],
    'docs/topology.md': ['guides/source/topology'],
    'docs/panes.md': ['guides/source/panes'],
    'docs/control.md': ['guides/source/control'],
    'docs/commands.md': ['guides/source/commands'],
    'docs/buffers.md': ['guides/source/buffers'],
    'docs/clients.md': ['guides/source/clients'],
    'docs/environment.md': ['guides/source/environment'],
    'docs/settings.md': ['guides/source/settings'],
    'docs/fields.md': ['guides/source/fields'],
    'docs/options-reference.md': ['guides/source/options'],
    'docs/compatibility.md': ['guides/source/compatibility'],
  },
}

const expand = (value) => value.startsWith('~/') ? join(homedir(), value.slice(2)) : value

function titleAndBody(content, sourcePath) {
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
  return content.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (all, image, label, destination) => {
    if (external(destination)) return all
    const [target, fragment = ''] = destination.split('#', 2)
    const normalized = posix.normalize(posix.join(posix.dirname(sourcePath), target))
    const staged = routes[normalized]
    let href
    if (staged) {
      href = posix.relative(route, staged[0]) || '.'
      if (!href.startsWith('.')) href = `./${href}`
      href = `${href.replace(/\/$/, '')}/${fragment ? `#${fragment}` : ''}`
    } else {
      const mode = image ? 'raw' : 'blob'
      href = `https://github.com/${repo}/${mode}/${revision}/${normalized}${fragment ? `#${fragment}` : ''}`
    }
    return `${image}[${label}](${href})`
  })
}

function stagedFiles(port, artifact) {
  const routes = ROUTES[port]
  const guides = new Map((artifact.guides ?? []).map((guide) => [guide.path, guide.content]))
  const files = new Map()
  for (const [sourcePath, [route, product]] of Object.entries(routes)) {
    const content = guides.get(sourcePath)
    if (typeof content !== 'string') throw new Error(`${port}: native artifact is missing guide ${sourcePath}`)
    const { title, body } = titleAndBody(content, sourcePath)
    const rewritten = rewriteLinks(body, sourcePath, route, routes, artifact.source.repository, artifact.source.revision)
    const data = {
      title,
      description: `Source-owned ${port === 'ruby' ? 'Ruby' : 'Lua'} guide at ${artifact.source.revision.slice(0, 12)}.`,
      port,
      ...(product ? { product } : {}),
      route,
      source: { repo: artifact.source.repository, path: sourcePath, ref: artifact.source.revision },
      sidebar: { group: product ? (product === 'mcp' ? 'MCP' : 'Workspace Manager') : 'Guides' },
    }
    const frontmatter = Object.entries(data).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')
    files.set(`${port}/${route}/index.md`, `---\n${frontmatter}\n---\n\n${rewritten.trim()}\n`)
  }
  return files
}

function artifactFromSource(port, checkout) {
  const modelPath = join(root, `site/src/data/api/${port.slug}.json`)
  const model = JSON.parse(readFileSync(modelPath, 'utf8'))
  const head = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (head !== model.revision) {
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
  for (const port of PORTS.filter((entry) => entry.slug in ROUTES && (!selectedPort || entry.slug === selectedPort))) {
    const checkout = expand(process.env[`LIBTMUX_DOCS_CHECKOUT_${port.slug.toUpperCase()}`] || port.worktree)
    const artifactPath = join(checkout, 'docs/_build/api.json')
    if (!fromSource && !existsSync(artifactPath)) throw new Error(`${port.slug}: native artifact missing at ${artifactPath}`)
    const artifact = fromSource
      ? artifactFromSource(port, checkout)
      : JSON.parse(readFileSync(artifactPath, 'utf8'))
    const expected = process.env.LIBTMUX_DOCS_SOURCE_SHA
    if (selectedPort && expected && artifact.source?.revision !== expected) {
      throw new Error(`${port.slug}: expected source ${expected}, artifact records ${artifact.source?.revision}`)
    }
    for (const [file, content] of stagedFiles(port.slug, artifact)) generated.set(file, content)
  }

  if (check) {
    const actual = new Map()
    const walk = (directory, prefix = '') => {
      if (!existsSync(directory)) return
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const relative = posix.join(prefix, entry.name)
        if (entry.isDirectory()) walk(join(directory, entry.name), relative)
        else actual.set(relative, readFileSync(join(directory, entry.name), 'utf8'))
      }
    }
    walk(output)
    const stale = generated.size !== actual.size || [...generated].some(([file, content]) => actual.get(file) !== content)
    if (stale) throw new Error('staged port guides are missing or stale; rerun without --check')
  } else {
    rmSync(output, { recursive: true, force: true })
    for (const [file, content] of generated) {
      const destination = join(output, file)
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(destination, content)
    }
  }

  console.log(`stage-port-docs: ${generated.size} guides from ${selectedPort ?? 'ruby,lua'}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run()
