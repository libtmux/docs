#!/usr/bin/env node
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORT_BY_SLUG } from '../site/src/lib/ports.ts'

/** Keep generated native shell assets inside the assembly's locale and preview. */
export function normalizeNativeShell(directory, prefix, { sphinxPort } = {}) {
  const port = sphinxPort ? PORT_BY_SLUG[sphinxPort] : undefined
  if (sphinxPort && port?.renderer !== 'sphinx') throw new Error(`Not a Sphinx port: ${sphinxPort}`)
  const root = prefix.replace(/\/+$/, '')
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
        if (port && entry.name.endsWith('.html') && !/<meta\b[^>]*http-equiv=["']refresh["']/i.test(after)) {
          if (!/<\/head>/i.test(after)) throw new Error(`Native page has no closing head: ${path}`)
          // Old source refs may predate the shell; replace existing integration once.
          after = after
            .replace(/<script\b[^>]*\bsrc=["'][^"']*\/_shell\/shell\.js(?:\?[^"']*)?["'][^>]*>[\s\S]*?<\/script>\s*/gi, '')
            .replace(/<link\b[^>]*\bhref=["'][^"']*\blibtmux-org\.css(?:\?[^"']*)?["'][^>]*>\s*/gi, '')
          const cssUrl = relative(dirname(path), adapterPath).split(sep).join('/')
          after = after.replace(/<\/head>/i, `<link rel="stylesheet" href="${cssUrl}">\n<script defer src="${root}/_shell/shell.js"></script>\n</head>`)
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
  const [directory, prefix, sphinxPort] = process.argv.slice(2)
  if (!directory || !prefix?.startsWith('/')) {
    throw new Error('Usage: normalize-native-shell.mjs DIRECTORY /LOCALE_PREFIX [SPHINX_PORT]')
  }
  console.log(`Native shell: prepared ${normalizeNativeShell(directory, prefix, { sphinxPort })} HTML/CSS files`)
}
