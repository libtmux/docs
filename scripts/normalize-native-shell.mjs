#!/usr/bin/env node
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { PORT_BY_SLUG } from '../site/src/lib/ports.ts'

const currentPage = '__LIBTMUX_NATIVE_CURRENT_PAGE__'
const escapeAttribute = (text) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')

/** Render the runtime's own chrome once per port/version, without network access. */
async function renderChrome(root, port, version) {
  const window = new Window({ url: `https://libtmux.org${root}/${port.slug}/${version}/api/` })
  window.fetch = async () => ({ ok: false })
  try {
    window.eval(readFileSync(new URL('../site/public/_shell/shell.js', import.meta.url), 'utf8'))
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'))
    const header = window.document.querySelector('[data-lt-shell="header"]')
    const footer = window.document.querySelector('[data-lt-shell="footer"]')
    const style = window.document.getElementById('lt-shell-style')
    if (!header || !footer || !style) throw new Error('Native shell did not render its header, footer and styles')
    for (const link of header.querySelectorAll('[data-page-port-switcher] a[aria-current], a[lang="en"]')) {
      link.setAttribute('href', currentPage)
    }
    return { header: header.outerHTML, footer: footer.outerHTML, style: style.outerHTML }
  } finally {
    await window.happyDOM.close()
  }
}

/**
 * Keep generated native shell assets inside the assembly's locale and preview.
 * @param {string} directory
 * @param {string} prefix
 * @param {{ sphinxPort?: string, version?: string }} [options]
 */
export async function normalizeNativeShell(directory, prefix, { sphinxPort, version = 'latest' } = {}) {
  const port = sphinxPort ? PORT_BY_SLUG[sphinxPort] : undefined
  if (sphinxPort && port?.renderer !== 'sphinx') throw new Error(`Not a Sphinx port: ${sphinxPort}`)
  const root = prefix.replace(/\/+$/, '')
  const chrome = port ? await renderChrome(root, port, version) : undefined
  const normalize = (content) => content.replace(/(['"(])(?:https?:\/\/libtmux\.org)?\/_shell\//g, `$1${root}/_shell/`)
  const adapterPath = join(directory, '_static/libtmux-org.css')
  if (port) {
    mkdirSync(dirname(adapterPath), { recursive: true })
    writeFileSync(adapterPath, normalize(readFileSync(new URL('../site/public/_shell/sphinx.css', import.meta.url), 'utf8')))
  }
  let changed = 0
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== '_sources') walk(path)
      } else if (/\.(html|css)$/.test(entry.name)) {
        const before = readFileSync(path, 'utf8')
        let after = normalize(before)
        // Native search delegates to the owned search page for this port/version.
        if (port && /^search(?:\.html|\/index\.html)$/.test(relative(directory, path).split(sep).join('/'))) {
          const target = `${root}/${port.slug}/${version}/search/`
          const href = escapeAttribute(target)
          const scriptTarget = JSON.stringify(target).replaceAll('<', '\\u003c')
          after = `<!doctype html>
<html><head><meta charset="utf-8"><title>Search</title>
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="${href}">
<script>window.location.replace(${scriptTarget} + window.location.search + window.location.hash)</script>
<meta http-equiv="refresh" content="0; url=${href}">
</head><body><p><a href="${href}">Search the ${port.name} documentation</a>.</p></body></html>
`
        }
        if (port && entry.name.endsWith('.html') && !/<meta\b[^>]*http-equiv=["']refresh["']/i.test(after)) {
          if (!/<\/head>/i.test(after)) throw new Error(`Native page has no closing head: ${path}`)
          // Old source refs may predate the shell; replace existing integration once.
          after = after
            .replace(/<script\b[^>]*\bsrc=["'][^"']*\/_shell\/shell\.js(?:\?[^"']*)?["'][^>]*>[\s\S]*?<\/script>\s*/gi, '')
            .replace(/<link\b[^>]*\bhref=["'][^"']*\blibtmux-org\.css(?:\?[^"']*)?["'][^>]*>\s*/gi, '')
            .replace(/<style\b[^>]*\bid=["']lt-shell-style["'][^>]*>[\s\S]*?<\/style>\s*/gi, '')
            .replace(/<!-- libtmux-native-(header|footer) -->[\s\S]*?<!-- \/libtmux-native-\1 -->\s*/g, '')
          const cssUrl = relative(dirname(path), adapterPath).split(sep).join('/')
          after = after.replace(/<\/head>/i, `<link rel="stylesheet" href="${cssUrl}">\n${chrome.style}\n<script defer src="${root}/_shell/shell.js"></script>\n</head>`)
          if (!/<body\b[^>]*>/i.test(after) || !/<\/body>/i.test(after)) throw new Error(`Native page has no body: ${path}`)
          const pageUrl = `${root}/${port.slug}/${version}/api/${relative(directory, path).split(sep).join('/').replace(/index\.html$/, '')}`
          const header = chrome.header.replaceAll(currentPage, escapeAttribute(pageUrl))
          after = after
            .replace(/(<body\b[^>]*>)\s*/i, `$1\n<!-- libtmux-native-header -->${header}<!-- /libtmux-native-header -->\n`)
            .replace(/\s*<\/body>/i, `\n<!-- libtmux-native-footer -->${chrome.footer}<!-- /libtmux-native-footer -->\n</body>`)
          if (!/<article\b/i.test(after)) throw new Error(`Native page has no article: ${path}`)
          after = after.replace(/<article\b([^>]*)>/i, (_tag, attributes) => {
            const clean = attributes.replace(/\sdata-pagefind-(?:body|filter)(?:=["'][^"']*["'])?/gi, '')
            return `<article${clean} data-pagefind-body data-pagefind-filter="port:${port.name}">`
          })
        }
        if (after !== before) {
          writeFileSync(path, after)
          changed++
        }
      }
    }
  }
  walk(directory)
  return changed
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, prefix, sphinxPort, version] = process.argv.slice(2)
  if (!directory || !prefix?.startsWith('/')) {
    throw new Error('Usage: normalize-native-shell.mjs DIRECTORY /LOCALE_PREFIX [SPHINX_PORT VERSION]')
  }
  console.log(`Native shell: prepared ${await normalizeNativeShell(directory, prefix, { sphinxPort, version })} HTML/CSS files`)
}
