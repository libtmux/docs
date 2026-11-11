/**
 * Render README badges from data the build already holds.
 *
 * Source guides hotlink img.shields.io and GitHub Actions badges, so every
 * reader's browser (and every CI browser check) waits on a third party. This
 * maps each shields URL to a label, message and colour, renders the SVG with
 * shields' own `badge-maker`, and points the Markdown image at a
 * content-hashed file served from the site's origin.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeBadge } from 'badge-maker'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { toMarkdown } from 'mdast-util-to-markdown'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
export const BADGE_DIRECTORY = 'badges'

/**
 * Registries whose `/<service>/v/<qualifier>.../<package>` badge reports a
 * published version. `label` is what shields shows without a `label` query;
 * `qualifiers` counts the path segments before the package (a LuaRocks user,
 * a Maven group).
 */
const VERSION_SERVICES = {
  gem: { label: 'gem', qualifiers: 0 },
  crates: { label: 'crates.io', qualifiers: 0 },
  hexpm: { label: 'hex', qualifiers: 0 },
  luarocks: { label: 'luarocks', qualifiers: 1 },
  'maven-central': { label: 'maven-central', qualifiers: 1 },
  npm: { label: 'npm', qualifiers: 0 },
  nuget: { label: 'nuget', qualifiers: 0 },
  powershellgallery: { label: 'powershell gallery', qualifiers: 0 },
  pypi: { label: 'pypi', qualifiers: 0 },
}

const OFF_ORIGIN = /^https?:\/\/(?:img\.shields\.io|badgen\.net|badge\.fury\.io|(?:www\.)?github\.com\/[^/]+\/[^/]+\/(?:actions\/workflows\/[^/]+|workflows\/[^/]+)\/badge\.svg|github\.com\/[^/]+\/[^/]+\/workflows\/.*\/badge\.svg)/i

export function isOffOriginBadge(url) {
  return OFF_ORIGIN.test(url)
}

/** Every off-origin badge URL in staged Markdown or HTML, whatever syntax holds it. */
export function findOffOriginBadges(content) {
  return [...content.matchAll(/https?:\/\/[^\s)"'<>]+/g)].map((match) => match[0]).filter(isOffOriginBadge)
}

/** shields static-badge escaping: `--` is a dash, `__` an underscore, `_` a space. */
function unescapeStatic(part) {
  return decodeURIComponent(part).split('--').map((piece) => piece.split('__').map((word) => word.replaceAll('_', ' ')).join('_')).join('-')
}

function registryVersion(registry = readRegistry(), port, name) {
  const entry = registry.ports[port]
  const version = entry?.packages?.[name]?.version ?? (entry?.packages ? undefined : entry?.version)
  if (!version) throw new Error(`${port}: badge names package ${name}, which the registry data does not carry`)
  return version
}

/**
 * Version colour as shields picks it (`version` in services/color-formatters.js
 * at server-2026-08-21, commit 080e177a0a44): orange when the first digit is 0
 * or the string names a pre-release, blue otherwise. PyPI badges use shields'
 * PEP 440 variant, which differs only for strings no registry entry here holds.
 */
function versionColor(version) {
  const first = version.startsWith('v') ? version[1] : version[0]
  return first === '0' || /alpha|beta|snapshot|dev|pre|rc|scm|cvs/i.test(version) ? '#ea7233' : '#007ec6'
}

/** shields' `addv`: a version that already starts with `v` keeps it. */
function addV(version) {
  return version.startsWith('v') ? version : `v${version}`
}

/** Resolve one shields URL to badge-maker input, or `null` for a status badge to drop. */
export function badgeSpec(url, { port, registry }) {
  const parsed = new URL(url)
  if (parsed.hostname !== 'img.shields.io') {
    if (parsed.pathname.endsWith('/badge.svg')) return null
    throw new Error(`${port}: unsupported badge host ${parsed.hostname}`)
  }
  const query = Object.fromEntries(parsed.searchParams)
  const unsupported = Object.keys(query).filter((key) => !['label', 'color'].includes(key))
  if (unsupported.length) throw new Error(`${port}: unsupported badge parameter ${unsupported.join(',')} in ${url}`)
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments[0] === 'badge') {
    const match = /^(.+?)(?<!-)-(?!-)(.+?)(?<!-)-(?!-)([^-]+)$/.exec(segments.slice(1).join('/'))
    if (!match) throw new Error(`${port}: unsupported static badge ${url}`)
    const [, label, message, color] = match
    return { label: query.label ?? unescapeStatic(label), message: unescapeStatic(message), color: query.color ?? color }
  }
  const service = Object.hasOwn(VERSION_SERVICES, segments[0]) ? VERSION_SERVICES[segments[0]] : undefined
  if (service && segments[1] === 'v' && segments.length === 3 + service.qualifiers) {
    const version = registryVersion(registry, port, decodeURIComponent(segments.at(-1)))
    return { label: query.label ?? service.label, message: addV(version), color: query.color ?? versionColor(version) }
  }
  throw new Error(`${port}: unsupported badge ${url}; add a mapping to scripts/lib/badges.mjs`)
}

let cachedRegistry
export function readRegistry() {
  cachedRegistry ??= JSON.parse(readFileSync(join(root, 'site/src/data/registry.json'), 'utf8'))
  return cachedRegistry
}

/**
 * Rewrite badge images in `content`. Returns the new Markdown and the SVG
 * files to publish, keyed by `badges/<hash>.svg`. Status badges are dropped
 * with their link: their value is a live CI result the build cannot know.
 */
export function localizeBadges(content, port, registry) {
  const files = new Map()
  const edits = []
  const visit = (node, parent) => {
    if (node.type === 'image' && isOffOriginBadge(node.url)) {
      const spec = badgeSpec(node.url, { port, registry })
      const droppable = parent?.type === 'link' && parent.children.length === 1 ? parent : node
      if (!spec) {
        edits.push({ start: droppable.position.start.offset, end: droppable.position.end.offset, text: '' })
        return
      }
      const svg = makeBadge({ label: spec.label, message: spec.message, color: spec.color })
      const name = `${BADGE_DIRECTORY}/${createHash('sha256').update(svg).digest('hex').slice(0, 12)}.svg`
      files.set(name, svg)
      node.url = `/${name}`
      node.alt = node.alt || `${spec.label}: ${spec.message}`
      edits.push({ start: node.position.start.offset, end: node.position.end.offset, text: toMarkdown(node).trimEnd() })
      return
    }
    for (const child of node.children ?? []) visit(child, node)
  }
  visit(fromMarkdown(content), undefined)
  for (const { start, end, text } of edits.sort((a, b) => b.start - a.start)) {
    content = content.slice(0, start) + text + content.slice(end)
  }
  return { content, files }
}

/**
 * Whether any badge among the staged `files` is missing from `directory` or
 * holds other bytes. Badge files are content-hashed and shared by every port,
 * so a port-scoped staging leaves other ports' files in place: extras in the
 * directory are not stale.
 */
export function badgesStale(files, directory) {
  return [...files].some(([name, svg]) => {
    if (!name.startsWith(`${BADGE_DIRECTORY}/`)) return false
    const path = join(directory, basename(name))
    return !existsSync(path) || readFileSync(path, 'utf8') !== svg
  })
}

/**
 * Every badge in `content` that `badgeSpec` cannot render, one problem each,
 * naming the port and the URL. `localizeBadges` stops at the first such badge;
 * a check over many files wants all of them.
 */
export function badgeProblems(content, port, registry) {
  return findOffOriginBadges(content).flatMap((url) => {
    try {
      badgeSpec(url, { port, registry })
      return []
    } catch (error) {
      return [{ port, url, reason: error.message.replace(`${port}: `, '') }]
    }
  })
}
