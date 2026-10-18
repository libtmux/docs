/**
 * What a port's workspace documentation names that has its own place to land:
 * the commands of its CLI Manual, the options its tables define, and the
 * configuration keys its Configuration reference defines.
 *
 * The rendered page numbers table rows with `createRowAnchors`, which this
 * indexer drives with the same headings and rows, so a recorded anchor is the
 * anchor the page serves. Reading Markdown rather than HTML needs no build and
 * works on the synthetic per-port pages the shared sources produce.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createRowAnchors } from '../../site/src/lib/row-anchors.ts'
import { KNOWN_PORTS, resolvePortBody } from '../../site/src/lib/workspace-shared-slots.ts'

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/
/** A configuration table lists keys under one of these headings. */
const KEY_HEADERS = new Set(['key', 'keys', 'field', 'fields', 'setting', 'settings'])
const OPTION_HEADER = /\b(?:options?|flags?)\b/i

function markdownFiles(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return markdownFiles(path)
    return /\.mdx?$/.test(entry.name) ? [path] : []
  })
}

const routeOf = (relPath) => `workspace/${relPath.replace(/\.mdx?$/, '').replace(/(?:^|\/)index$/, '')}`.replace(/\/$/, '')
const orderOf = (source) => Number(/^sidebar:\s*\n(?:[ \t]+\S.*\n)*?[ \t]+order:\s*(-?\d+)/m.exec(FRONTMATTER.exec(source)?.[0] ?? '')?.[1] ?? Number.MAX_SAFE_INTEGER)

/**
 * The workspace pages a port publishes, keyed by route. A page the port
 * writes itself wins over the shared source at that route, as the loader decides.
 */
export function workspacePages({ docs, shared }, port) {
  const pages = new Map()
  const home = join(docs, 'ports', port, 'workspace')
  for (const file of markdownFiles(home)) {
    const source = readFileSync(file, 'utf8')
    pages.set(routeOf(relative(home, file)), { body: source.replace(FRONTMATTER, ''), order: orderOf(source) })
  }
  if (!KNOWN_PORTS.has(port)) return pages
  const common = join(shared, 'workspace')
  for (const file of markdownFiles(common)) {
    const route = routeOf(relative(common, file))
    if (pages.has(route)) continue
    const source = readFileSync(file, 'utf8')
    const body = resolvePortBody(source.replace(FRONTMATTER, ''), port)
    if (body.trim()) pages.set(route, { body, order: orderOf(source) })
  }
  return pages
}

/** Text as it renders: no link targets, code fences or emphasis markers. */
const plain = (markdown) => markdown
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, '$1')
  .replace(/<[^>]+>/g, '').replace(/`+/g, '').replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1').trim()

/** github-slugger, which assigns heading ids: lower case, no punctuation, hyphens for spaces. */
function headingIds(headings) {
  const occurrences = new Map()
  return headings.map((text) => {
    const base = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}_ -]/gu, '').replaceAll(' ', '-')
    let id = base
    while (occurrences.has(id)) {
      occurrences.set(base, occurrences.get(base) + 1)
      id = `${base}-${occurrences.get(base)}`
    }
    occurrences.set(id, 0)
    return id
  })
}

const cellsOf = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.trim().replaceAll('\\|', '|'))
const SEPARATOR = /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/

/** Every table of a page with the anchor each body row receives, in document order. */
export function pageTables(body) {
  const lines = body.split('\n')
  const fenced = []
  let fence = false
  const headings = []
  lines.forEach((line, index) => {
    if (/^ {0,3}(?:`{3,}|~{3,})/.test(line)) { fence = !fence; fenced[index] = true; return }
    fenced[index] = fence
    const heading = /^(#{1,6})[ \t]+(.+?)[ \t#]*$/.exec(line)
    if (!fence && heading) headings.push({ index, depth: heading[1].length, text: plain(heading[2]) })
  })
  const ids = headingIds(headings.map((heading) => heading.text))
  headings.forEach((heading, index) => { heading.id = ids[index] })
  const taken = [...ids, ...[...body.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])]
  const anchors = createRowAnchors(taken)
  const tables = []
  for (let index = 0; index < lines.length; index++) {
    const heading = headings.find((entry) => entry.index === index)
    if (heading) anchors.heading(heading.depth, heading.id)
    if (fenced[index] || !lines[index].startsWith('|') || !SEPARATOR.test(lines[index + 1] ?? '')) continue
    const table = { header: plain(cellsOf(lines[index])[0] ?? ''), rows: [] }
    for (index += 2; index < lines.length && lines[index].startsWith('|') && !fenced[index]; index++) {
      const first = cellsOf(lines[index])[0] ?? ''
      const label = plain(first)
      if (label) table.rows.push({ cell: first, anchor: anchors.row(label) })
    }
    index--
    tables.push(table)
  }
  return tables
}

const codeSpans = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim())

/** The commands, options and keys one port's pages define. */
export function portEntities(pages, program) {
  const cli = [...pages].filter(([route]) => /^workspace\/cli\/[^/]+$/.test(route)).map(([route]) => route.slice('workspace/cli/'.length))
  const listed = new Set([...(pages.get('workspace/cli')?.body ?? '').matchAll(/<dt><a href="\.\/([^"/]+)\/"><code>([^<]+)<\/code><\/a><\/dt>/g)]
    .filter((match) => match[1] === match[2]).map((match) => match[1]))
  // A page named after a listed command plus a suffix documents its subcommand.
  const commands = cli.map((slug) => {
    const parent = [...listed].find((name) => slug.startsWith(`${name}-`) && cli.includes(name))
    return { name: parent ? `${parent} ${slug.slice(parent.length + 1)}` : slug, path: `workspace/cli/${slug}`, listed: listed.has(slug) }
  }).sort((a, b) => a.name.localeCompare(b.name))

  const options = []
  const keys = []
  const routes = [...pages].map(([route, page]) => ({ route, ...page })).sort((a, b) => a.order - b.order || a.route.localeCompare(b.route))
  for (const { route, body } of routes) {
    const isCli = route === 'workspace/cli' || route.startsWith('workspace/cli/')
    const isConfiguration = route.startsWith('workspace/configuration/')
    if (!isCli && !isConfiguration) continue
    for (const table of pageTables(body)) {
      const header = table.header.toLowerCase()
      for (const row of table.rows) {
        if (isCli && OPTION_HEADER.test(header)) {
          for (const span of codeSpans(row.cell)) {
            const name = span.split(/\s+/)[0]
            if (/^-{1,2}[A-Za-z0-9][\w-]*$/.test(name)) options.push({ name, path: route, anchor: row.anchor })
          }
        } else if (isConfiguration && KEY_HEADERS.has(header)) {
          for (const span of codeSpans(row.cell)) {
            const name = span.replace(/^"([^"]+)"$/, '$1')
            if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) keys.push({ name, path: route, anchor: row.anchor })
          }
        }
      }
    }
  }
  return { program, commands, options, keys }
}

/** Ports with the same entities share one group, so the shared sources are stored once. */
export function collectWorkspaceEntities({ docs, shared, ports }) {
  const groups = new Map()
  for (const { slug, program } of ports) {
    if (!program) continue
    const entities = portEntities(workspacePages({ docs, shared }, slug), program)
    if (!entities.commands.length && !entities.options.length && !entities.keys.length) continue
    const key = JSON.stringify(entities)
    groups.set(key, { ports: [...(groups.get(key)?.ports ?? []), slug], ...entities })
  }
  return [...groups.values()].sort((a, b) => a.ports[0].localeCompare(b.ports[0]))
}

/** One entity per line, so a changed row is one changed line in review. */
export function formatWorkspaceEntities(groups) {
  const rows = (items, fields) => `[${items.length ? `\n    ${items.map((item) => JSON.stringify(fields.map((field) => item[field]))).join(',\n    ')}\n   ` : ''}]`
  const body = groups.map((group) => [
    `  {\n   "ports": ${JSON.stringify(group.ports)},\n   "program": ${JSON.stringify(group.program)},`,
    `   "commands": ${rows(group.commands, ['name', 'path', 'listed'])},`,
    `   "options": ${rows(group.options, ['name', 'path', 'anchor'])},`,
    `   "keys": ${rows(group.keys, ['name', 'path', 'anchor'])}\n  }`,
  ].join('\n'))
  return `{\n "groups": [\n${body.join(',\n')}\n ]\n}\n`
}
