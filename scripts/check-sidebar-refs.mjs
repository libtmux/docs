#!/usr/bin/env node
/**
 * Every port's sidebar offers this site's reference, and the ecosystem link
 * beside it where there is one.
 *
 * `sidebarFor` used to return a single reference entry — the ecosystem host
 * when a port had one and this site otherwise — so the two could never
 * coexist and five of the eight ports never linked the reference this site
 * generates for them. That was invisible in a build: every link resolved,
 * because the missing one was simply never emitted.
 *
 * Reads the assembled HTML rather than the source, because what matters is
 * what a reader is offered on the page. Checks the desktop sidebar and the
 * mobile drawer, which render the same tree and so must agree.
 *
 * Usage: node scripts/check-sidebar-refs.mjs [site-dir]
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SITE = resolve(process.argv[2] ?? join(root, '_site'))

/** Ports with a canonical reference elsewhere, and the host that serves it. */
const ECOSYSTEM = { rs: 'docs.rs', go: 'pkg.go.dev', java: 'javadoc.io' }
const { PORTS: PORT_DEFS } = await import(`file://${resolve(root, 'site/src/lib/ports.ts')}`)
const PORTS = PORT_DEFS.map((p) => p.slug)

/** A page under each port that renders the docs shell. */
function pageFor(port) {
  for (const p of [`${port}/concepts/index.html`, `${port}/stable/concepts/index.html`]) {
    if (existsSync(join(SITE, p))) return join(SITE, p)
  }
  return undefined
}

const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&#\d+;|&\w+;/g, '').replace(/\s+/g, ' ').trim()

/** The links of one navigation region, in document order. */
function linksIn(html, pattern) {
  const region = pattern.exec(html)
  if (!region) return undefined
  return [...region[0].matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: m[1],
    label: strip(m[2]),
    external: /rel="[^"]*noopener|target="_blank"/.test(m[0]) || /^https?:/.test(m[1]),
  }))
}

const failures = []
const rows = []

for (const port of PORTS) {
  const file = pageFor(port)
  if (!file) {
    failures.push(`${port}: no shell page found under ${SITE}`)
    continue
  }
  const html = readFileSync(file, 'utf8')
  /*
   * Both copies of the tree, told apart by position rather than by selector.
   *
   * The shell renders `<nav class="sidebar-nav">` twice — once inside the
   * mobile drawer and once as the desktop column — and the drawer comes
   * first. A regex for "the sidebar nav" therefore matches the drawer, and
   * comparing that against the drawer compares it with itself and passes on
   * anything.
   */
  const navs = [...html.matchAll(/<nav[^>]*class="[^"]*sidebar[\s\S]*?<\/nav>/g)].map((m) =>
    linksIn(m[0], /[\s\S]*/),
  )
  const [drawer, desktop] = navs.length > 1 ? navs : [undefined, navs[0]]
  const sidebar = desktop ?? drawer
  if (!sidebar) {
    failures.push(`${port}: no sidebar in ${file.replace(`${SITE}/`, '')}`)
    continue
  }

  // The drawer renders the same tree, so it must offer the same references.
  // A reader on a phone is the one most likely to be looking for the API and
  // least able to hunt for it.
  if (desktop && drawer) {
    const refsOf = (links) =>
      links
        .filter((l) => l.href.includes('/reference/') || /\/py\/[^/]+\/api\//.test(l.href) ||
          Object.values(ECOSYSTEM).some((h) => l.href.includes(h)))
        .map((l) => `${l.label}|${l.href}`)
        .join(', ')
    if (refsOf(desktop) !== refsOf(drawer)) {
      failures.push(
        `${port}: the mobile drawer offers different references — sidebar [${refsOf(desktop)}] drawer [${refsOf(drawer)}]`,
      )
    }
  }

  const ours = sidebar.findIndex((l) => l.href.replace(/^https?:\/\/[^/]+/, '') === `/reference/${port}/`)
  if (ours === -1) failures.push(`${port}: sidebar does not link /reference/${port}/`)
  else if (ours !== 0) failures.push(`${port}: /reference/${port}/ is entry ${ours}, not first`)

  const host = ECOSYSTEM[port]
  if (host) {
    const eco = sidebar.find((l) => l.href.includes(host))
    if (!eco) failures.push(`${port}: sidebar does not link ${host}`)
    else if (!eco.external) failures.push(`${port}: ${host} is not marked as leaving the site`)
    else if (!eco.label.toLowerCase().includes(host.split('.')[0])) {
      failures.push(`${port}: ${host} entry is labelled "${eco.label}", not for its host`)
    }
  }

  if (port === 'py' && !sidebar.some((l) => /\/py\/[^/]+\/api\//.test(l.href))) {
    failures.push('py: sidebar does not link the upstream gp-sphinx reference')
  }

  // Every internal reference link must be a page that exists.
  for (const l of sidebar.filter((x) => !x.external && x.href.includes('/reference/'))) {
    const path = l.href.replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '')
    if (!existsSync(join(SITE, path, 'index.html'))) {
      failures.push(`${port}: ${l.href} is linked but not built`)
    }
  }

  const refs = sidebar.filter((l) => l.href.includes('/reference/') || Object.values(ECOSYSTEM).some((h) => l.href.includes(h)) || /\/py\/[^/]+\/api\//.test(l.href))
  rows.push({ port, refs })
}

for (const { port, refs } of rows) {
  console.log(`check-sidebar-refs: ${port.padEnd(7)} ${refs.map((r) => `${r.label}${r.external ? ' ↗' : ''}`).join('  |  ')}`)
}
if (failures.length) {
  console.error(`\ncheck-sidebar-refs: ${failures.length} problem(s):`)
  for (const f of failures) console.error(`  ${f}`)
  process.exit(1)
}
console.log('check-sidebar-refs: every port offers its reference')
