#!/usr/bin/env bash
# Mutate a sparse private copy so a failed control cannot alter the assembly.
set -euo pipefail
cd "$(dirname "$0")/.."
locale="${LIBTMUX_DOCS_LOCALE:-en}"
site_out="${1:-${LIBTMUX_DOCS_OUT_DIR:-_site}/$locale}"
if [[ $# == 0 && ! -d "$site_out" ]]; then site_out="${LIBTMUX_DOCS_OUT_DIR:-_site}"; fi
node --input-type=module - "$site_out" <<'JS'
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Window } from 'happy-dom'
import { API_MODEL_PORTS } from './site/src/lib/ports.ts'

const source = resolve(process.argv[2])
const copy = mkdtempSync(join(tmpdir(), 'libtmux-reference-negative-'))
const servedRoot = `${process.env.LIBTMUX_DOCS_LOCALES_ROOT ?? ''}/${process.env.LIBTMUX_DOCS_LOCALE ?? 'en'}/`
const window = new Window({ settings: { enableJavaScriptEvaluation: false, disableCSSFileLoading: true, disableJavaScriptFileLoading: true } })
const template = window.document.createElement('template')
const pages = new Map()
function pageFor(port) {
  const root = join(source, port)
  for (const suffix of ['concepts/index.html', ...readdirSync(root).flatMap((version) =>
    [`${version}/concepts/index.html`, `${version}/index.html`])]) {
    if (existsSync(join(root, suffix))) return join(root, suffix)
  }
  throw new Error(`${port}: no shell page under ${source}`)
}
function preserve(file) {
  const target = join(copy, relative(source, file))
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(file, target)
  return target
}
function coreOf() {
  return [...template.content.querySelectorAll('[data-surface-picker] [data-surface-group]')].find((group) =>
    group.querySelector(':scope > summary strong')?.textContent.trim() === 'Core Library')
}
function run() {
  return spawnSync(process.execPath, ['scripts/check-sidebar-refs.mjs', copy], { encoding: 'utf8', env: process.env })
}
function rejects(name, port, mutate, message) {
  const file = pages.get(port)
  const original = readFileSync(file, 'utf8')
  template.innerHTML = original
  const core = coreOf()
  assert(core, `${name}: missing Core Library group`)
  mutate(core)
  writeFileSync(file, template.innerHTML)
  try {
    const result = run()
    assert.equal(result.status, 1, `${name}: check must reject mutation`)
    assert(result.stderr.includes(message), `${name}: expected ${message}\n${result.stderr}`)
    console.log(`  ok    ${name}: exit 1, ${message}`)
  } finally { writeFileSync(file, original) }
}
try {
  for (const { slug } of API_MODEL_PORTS) {
    pages.set(slug, preserve(pageFor(slug)))
    template.innerHTML = readFileSync(pages.get(slug), 'utf8')
    for (const link of coreOf().querySelectorAll('a[href]')) {
      const href = link.getAttribute('href')
      if (href.startsWith(servedRoot) && href.includes('/reference/')) {
        preserve(join(source, href.slice(servedRoot.length), 'index.html'))
      }
    }
  }
  assert.equal(run().status, 0, 'Unmodified private copy must pass before any mutation')
  const reference = (core) => core.querySelector('.surface-options a[href$="/reference/"]')
  // Leave identical links outside Core Library. A global href search would
  // incorrectly accept these missing destinations in the actual picker group.
  const moveOutside = (link) => {
    assert(link, 'mutation must find its anchor')
    template.content.append(link.cloneNode(true))
    link.remove()
  }
  const nativeMessage = 'rs: Core Library does not offer exactly one current native reference'
  rejects('native only outside Core Library', 'rs', (core) => moveOutside(reference(core)), nativeMessage)
  rejects('wrong native port', 'rs', (core) => reference(core).href = reference(core).getAttribute('href').replace('/rs/', '/go/'), nativeMessage)
  rejects('wrong native version', 'rs', (core) => reference(core).href = reference(core).getAttribute('href').replace(/\/[^/]+\/reference\/$/, '/other/reference/'), nativeMessage)
  rejects('foreign native origin', 'rs', (core) => reference(core).href = `https://example.com${reference(core).getAttribute('href')}`, nativeMessage)
  rejects('duplicate native reference', 'rs', (core) => reference(core).after(reference(core).cloneNode(true)), nativeMessage)
  const ecosystem = (core) => core.querySelector('.surface-alternatives a[href*="docs.rs"]')
  const ecoMessage = 'rs: Core Library does not offer exactly one docs.rs alternative'
  rejects('ecosystem only outside Core Library', 'rs', (core) => moveOutside(ecosystem(core)), ecoMessage)
  rejects('ecosystem host impersonation', 'rs', (core) => ecosystem(core).href = 'https://docs.rs.invalid/', ecoMessage)
  rejects('ecosystem external marker', 'rs', (core) => ecosystem(core).removeAttribute('target'), 'rs: docs.rs is not marked as leaving the site')
  rejects('ecosystem host label', 'rs', (core) => ecosystem(core).textContent = 'Elsewhere', 'rs: docs.rs entry is not labelled for its host')
  rejects('upstream only outside Core Library', 'py', (core) => moveOutside(core.querySelector('a[href$="/api/"]')),
    'py: Core Library does not offer exactly one current upstream gp-sphinx reference')
  rejects('foreign upstream origin', 'py', (core) => {
    const link = core.querySelector('a[href$="/api/"]')
    link.href = `https://example.com${link.getAttribute('href')}`
  }, 'py: Core Library does not offer exactly one current upstream gp-sphinx reference')
  template.innerHTML = readFileSync(pages.get('rs'), 'utf8')
  const href = reference(coreOf()).getAttribute('href')
  const destination = join(copy, href.slice(servedRoot.length), 'index.html')
  const original = readFileSync(destination)
  rmSync(destination)
  const missing = run()
  assert.equal(missing.status, 1)
  assert(missing.stderr.includes(`rs: ${href} is linked but not built`))
  writeFileSync(destination, original)
  console.log('  ok    native target missing: exit 1, linked but not built')
  assert.equal(run().status, 0, 'Restored private copy must pass')
  console.log('  ok    restored private copy: exit 0; original assembly untouched')
} finally { rmSync(copy, { recursive: true, force: true }) }
JS
