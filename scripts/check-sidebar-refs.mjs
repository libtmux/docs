#!/usr/bin/env node
/**
 * Each port's Core Library picker offers its own reference and native or
 * ecosystem alternatives. The shared picker serves desktop and phone readers;
 * the section sidebar contains only the pages in the selected section.
 *
 * Usage: node scripts/check-sidebar-refs.mjs [locale-site-dir]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SITE = resolve(process.argv[2] ?? join(root, '_site'))

/** Ports with a canonical reference elsewhere, and the host that serves it. */
const ECOSYSTEM = { rs: 'docs.rs', go: 'pkg.go.dev', java: 'javadoc.io' }
const { API_MODEL_PORTS: PORT_DEFS } = await import(`file://${resolve(root, 'site/src/lib/ports.ts')}`)
const PORTS = PORT_DEFS.map((p) => p.slug)

/** A page under each port that renders the docs shell. */
// The locale segment a served href carries, stripped before comparison. The
// tree itself is whatever root this check was handed.
const LOCALE = process.env.LIBTMUX_DOCS_LOCALE ?? 'en'
const servedRoot = `${process.env.LIBTMUX_DOCS_LOCALES_ROOT ?? ''}/${LOCALE}/`

function pageFor(port) {
  return pageUnder(join(SITE, port))
}

/** A served href as a path below the site root, with the locale removed. */
const pathOf = (href) => {
  const path = href.replace(/^https?:\/\/[^/]+/, '')
  return path.startsWith(servedRoot) ? `/${path.slice(servedRoot.length)}` : path
}

function pageUnder(portDir) {
  const unversioned = join(portDir, 'concepts', 'index.html')
  if (existsSync(unversioned)) return unversioned
  /*
   * Whichever versions were built, rather than a slug guessed in advance.
   * `stable` was the guess, and it is absent for a port with no release — so
   * this reported seven ports as having no shell page at all when what they
   * had was a shell page somewhere this function did not look.
   */
  if (!existsSync(portDir)) return undefined
  for (const version of readdirSync(portDir)) {
    for (const route of ['concepts/index.html', 'index.html']) {
      const candidate = join(portDir, version, route)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

const window = new Window({
  settings: { enableJavaScriptEvaluation: false, disableCSSFileLoading: true, disableJavaScriptFileLoading: true },
})
const template = window.document.createElement('template')
const labelOf = (element) => element.textContent.replace(/\s+/g, ' ').trim()
const hrefOf = (link) => link.getAttribute('href') ?? ''
const owned = (link) => hrefOf(link).startsWith(servedRoot)
const hostOf = (href) => {
  try {
    return new URL(href).hostname
  } catch {
    return undefined
  }
}

const failures = []
const rows = []

for (const port of PORTS) {
  const file = pageFor(port)
  if (!file) {
    failures.push(`${port}: no shell page found under ${SITE}`)
    continue
  }
  template.innerHTML = readFileSync(file, 'utf8')
  const pickers = template.content.querySelectorAll('[data-surface-picker]')
  if (pickers.length !== 1) {
    failures.push(`${port}: expected one shared documentation picker, found ${pickers.length}`)
    continue
  }
  const cores = [...pickers[0].querySelectorAll('[data-surface-group]')].filter(
    (group) => group.querySelector(':scope > summary strong')?.textContent.trim() === 'Core Library',
  )
  if (cores.length !== 1) {
    failures.push(`${port}: expected one Core Library group, found ${cores.length}`)
    continue
  }
  const core = cores[0]
  const sections = [...core.querySelectorAll(':scope > .surface-options a[href]')]
  const alternatives = [...core.querySelectorAll(':scope > .surface-alternatives a[href]')]
  const links = [...sections, ...alternatives]
  // The sampled page supplies the version; a valid link to another version
  // must not satisfy the current context's native-reference contract.
  const version = relative(join(SITE, port), file).split('/')[0]
  const expected =
    version === 'concepts'
      ? new RegExp(`^/${port}/[^/]+/reference/$`)
      : new RegExp(`^/${port}/${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/reference/$`)
  const ours = sections.filter((link) => owned(link) && expected.test(pathOf(hrefOf(link))))
  if (ours.length !== 1) failures.push(`${port}: Core Library does not offer exactly one current native reference`)
  else if (labelOf(ours[0]) !== 'API Reference')
    failures.push(`${port}: native reference is not labelled API Reference`)

  const host = ECOSYSTEM[port]
  if (host) {
    const matches = alternatives.filter((link) => hostOf(hrefOf(link)) === host)
    if (matches.length !== 1) failures.push(`${port}: Core Library does not offer exactly one ${host} alternative`)
    else {
      const eco = matches[0]
      if (eco.getAttribute('target') !== '_blank' || !eco.relList.contains('noopener')) {
        failures.push(`${port}: ${host} is not marked as leaving the site`)
      }
      if (!labelOf(eco).toLowerCase().includes(host)) {
        failures.push(`${port}: ${host} entry is not labelled for its host`)
      }
    }
  }

  if (port === 'py') {
    const upstream = version === 'concepts' ? /^\/py\/[^/]+\/api\/$/ : new RegExp(`^/py/${version}/api/$`)
    if (alternatives.filter((link) => owned(link) && upstream.test(pathOf(hrefOf(link)))).length !== 1) {
      failures.push('py: Core Library does not offer exactly one current upstream gp-sphinx reference')
    }
  }

  // Native references must exist in this locale/prefix. Native Python output
  // has its own assembly gate; its picker destination is checked above.
  for (const link of links.filter((entry) => !hostOf(hrefOf(entry)) && hrefOf(entry).includes('/reference/'))) {
    const href = hrefOf(link)
    const path = pathOf(href).replace(/^\//, '')
    if (!existsSync(join(SITE, path, 'index.html'))) failures.push(`${port}: ${href} is linked but not built`)
  }
  const refs = links
    .filter(
      (link) =>
        hrefOf(link).includes('/reference/') ||
        Object.values(ECOSYSTEM).includes(hostOf(hrefOf(link))) ||
        /\/py\/[^/]+\/api\//.test(hrefOf(link)),
    )
    .map((link) => ({ label: labelOf(link), external: Boolean(hostOf(hrefOf(link))) }))

  rows.push({ port, refs })
}

for (const { port, refs } of rows) {
  console.log(
    `check-sidebar-refs: ${port.padEnd(7)} ${refs.map((r) => `${r.label}${r.external ? ' ↗' : ''}`).join('  |  ')}`,
  )
}
if (failures.length) {
  console.error(`\ncheck-sidebar-refs: ${failures.length} problem(s):`)
  for (const f of failures) console.error(`  ${f}`)
  process.exit(1)
}
console.log('check-sidebar-refs: every port offers its reference')
