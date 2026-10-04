#!/usr/bin/env node
// Validate the compiled native shell and its complete static asset closure.
// Usage: node scripts/inject-shell.mjs --site _site [--version stable]
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORTS } from '../site/src/lib/ports.ts'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const argument = (name) => {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}
const output = argument('--site') ?? join(repoRoot, '_site')
const selectedVersion = argument('--version')
const locale = process.env.LIBTMUX_DOCS_LOCALE || 'en'
const siteDir = existsSync(join(output, locale, 'index.html')) ? join(output, locale) : output
const prefix = `${(process.env.LIBTMUX_DOCS_LOCALES_ROOT || '').replace(/\/+$/, '')}/${locale}/`
const failures = new Set(),
  checked = [],
  skipped = [],
  assets = new Map(),
  allAssets = new Set()
const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const cssUrls = (css) =>
  [...stripCssComments(css).matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/g)].map(
    (match) => match[1] ?? match[2] ?? match[3],
  )

function files(directory, suffix) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path, suffix) : entry.name.endsWith(suffix) ? [path] : []
  })
}

function checkAsset(href, parent) {
  if (!href || /^(?:data:|#)/.test(href)) return
  const url = new URL(href, parent)
  if (url.origin !== 'https://libtmux.org') return
  if (!url.pathname.startsWith(prefix)) {
    failures.add(`Native asset escapes its locale/preview prefix: ${url.pathname}`)
    return
  }
  const file = join(siteDir, decodeURIComponent(url.pathname.slice(prefix.length)))
  if (assets.has(file)) return
  if (!existsSync(file) || !statSync(file).isFile()) {
    failures.add(`Native asset is missing: ${url.pathname}`)
    return
  }
  const text = /\.(css|js)$/.test(file) ? readFileSync(file, 'utf8') : ''
  assets.set(file, text)
  allAssets.add(file)
  if (file.endsWith('.css')) {
    for (const href of cssUrls(text)) checkAsset(href, url)
  } else if (file.endsWith('.js')) {
    for (const match of text.matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?)["']([^"']+)["']/g)) checkAsset(match[1], url)
  }
}

for (const port of PORTS.filter((entry) => entry.renderer === 'sphinx')) {
  const root = join(siteDir, port.slug)
  if (!existsSync(root)) {
    skipped.push(`${port.slug}: no assembled native reference`)
    continue
  }
  for (const version of readdirSync(root)) {
    if (selectedVersion && version !== selectedVersion) continue
    assets.clear()
    const inlineStyles = new Set()
    const native = join(root, version, 'api')
    const pages = files(native, '.html').filter((path) => !path.includes('/_sources/'))
    let count = 0
    for (const file of pages) {
      const html = readFileSync(file, 'utf8')
      if (/<meta\b[^>]*http-equiv=["']refresh["']/i.test(html)) continue
      count++
      const url = `https://libtmux.org${prefix}${relative(siteDir, file).replace(/index\.html$/, '')}`
      if (!html.includes('data-native-shell="')) failures.add(`${url}: compiled native shell is absent`)
      if (/data-native-shell-export|data-native-boundary/.test(html))
        failures.add(`${url}: temporary native export was published`)
      if (/<script[^>]*src=["'][^"']*(?:\/_shell\/shell\.js|(?:^|\/)spa-nav\.js)/.test(html))
        failures.add(`${url}: competing native shell/router remains`)
      for (const tag of html.matchAll(/<(?:link|script|img)\b[^>]*>/g)) {
        if (tag[0].startsWith('<link') && !/\b(?:rel="(?:stylesheet|preload|modulepreload)"|as="font")/.test(tag[0]))
          continue
        const asset = /\b(?:src|href)=["']([^"']+)["']/.exec(tag[0])?.[1]
        if (asset) checkAsset(asset, url)
      }
      for (const style of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) {
        inlineStyles.add(style[1])
        for (const href of cssUrls(style[1])) checkAsset(href, url)
      }
    }
    if (!count) {
      skipped.push(`${port.slug}/${version}: no native content`)
      continue
    }
    const styles = [...assets].filter(([file]) => file.endsWith('.css')).map(([, css]) => css)
    styles.push(...inlineStyles)
    const adapter = styles.find((css) => css.includes('html[data-native-shell]'))
    if (!adapter) failures.add(`${port.slug}/${version}: compiled native CSS is absent`)
    if (adapter) {
      const css = stripCssComments(adapter)
      const generated = files(join(native, '_static'), '.css')
        .filter((path) => !path.endsWith('/libtmux-org.css'))
        .map((path) => readFileSync(path, 'utf8'))
        .join('\n')
      const nativeRules = [...css.matchAll(/[^{}]*html\[data-native-shell\][^{}]*\{([^{}]*)\}/g)]
        .map((match) => match[1])
        .join('\n')
      for (const [name] of nativeRules.matchAll(/--color-[a-z0-9-]+(?=\s*:)/gi)) {
        if (!generated.includes(name))
          failures.add(`${port.slug}/${version}: native generator no longer declares ${name}`)
      }
      const compiled = styles.join('\n')
      for (const [, name] of nativeRules.matchAll(/var\((--(?:lt-)?[a-z0-9-]+)/gi)) {
        if (!compiled.includes(`${name}:`) && !css.includes(`${name}:`))
          failures.add(`${port.slug}/${version}: shared CSS does not declare ${name}`)
      }
    }
    checked.push(`${port.slug}/${version}: ${count} native pages`)
  }
}
console.log(`Native shell: ${checked.length} version builds, ${allAssets.size} static assets checked`)
for (const item of checked) console.log(`  ok    ${item}`)
for (const item of skipped) console.log(`  skip  ${item}`)
if (failures.size) {
  for (const item of failures) console.error(`  FAIL  ${item}`)
  process.exit(1)
}
