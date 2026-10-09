#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORT_BY_SLUG } from '../site/src/lib/ports.ts'
import { nativeArticle, nativeHash } from './native-shell-context.mjs'

const escapeAttribute = (text) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
const spaNavigationHash = '02509e118ca80bc577ad947e5aa6017aa3358d0e79b5213fbae77ed6a9a0c3c9'
const furoHash = 'b76a4a02a82fb459f2d11261deaf749309cf5810c8f192a0687439a4c222cade'
const highlightHash = '096231e9c87df80ec3273da9c5b71bc81503206726a07a4dd4de44c256ff859c'

/** Sphinx's optional search-term storage must not make a native page throw. */
function adaptHighlight(directory) {
  const file = join(directory, '_static/sphinx_highlight.js')
  if (!existsSync(file)) return 0
  const original = readFileSync(file, 'utf8')
  const get = 'localStorage.getItem("sphinx_highlight_terms")'
  const remove = 'localStorage.removeItem("sphinx_highlight_terms")'
  const guardedGet = `(() => { try { return ${get}; } catch { return null; } })()`
  const guardedRemove = `try { ${remove}; } catch {}`
  const before = original.replace(guardedGet, get).replaceAll(guardedRemove, remove)
  if (nativeHash(before) !== highlightHash) throw new Error(`Native search highlighter changed: ${file}`)
  const after = before.replace(get, guardedGet).replaceAll(remove, guardedRemove)
  if (after === original) return 0
  writeFileSync(file, after)
  return 1
}

/** Keep native widget behavior when Astro replaces the document body. */
function adaptWidgets(directory) {
  const assets = [
    ['doctools.js', '2992c09df91826a8d33e3b48b645ee77e457adcf7c712d776a814e1e2c448b43', [
      ['_ready(Documentation.init);', '_ready(Documentation.init);\ndocument.addEventListener("astro:after-swap", Documentation.initDomainIndexTable);'],
    ]],
    ['copybutton.js', '75381d09e0497b436ac3c7a1e690415e4f2ccf2b0cc5202fad70b3bdcb7bbf80', [
      ['const addCopyButtonToCodeCells = () => {', 'let nativeClipboard;\nconst addCopyButtonToCodeCells = () => {\n  nativeClipboard?.destroy();'],
      ["codeCell.insertAdjacentHTML('afterend', clipboardButton(id))", "if (!codeCell.nextElementSibling?.classList.contains('copybtn')) codeCell.insertAdjacentHTML('afterend', clipboardButton(id))"],
      ["const clipboard = new ClipboardJS('.copybtn', {text: copyTargetText})", "const clipboard = nativeClipboard = new ClipboardJS('.copybtn', {text: copyTargetText})"],
      ['runWhenDOMLoaded(addCopyButtonToCodeCells)', 'runWhenDOMLoaded(addCopyButtonToCodeCells)\ndocument.addEventListener("astro:page-load", addCopyButtonToCodeCells);\ndocument.addEventListener("astro:before-swap", () => nativeClipboard?.destroy());'],
    ]],
    ['design-tabs.js', 'de2467cfca5bb555043369f1eea82c9cd794e70fa0444f216aa4ebb18cefc9f0', [
      ['function ready() {', 'function ready() {\n  sd_id_to_elements = {};'],
      ['document.addEventListener("DOMContentLoaded", ready, false);', 'document.addEventListener("DOMContentLoaded", ready, false);\ndocument.addEventListener("astro:page-load", ready);'],
      ['window.sessionStorage.getItem(\n          storageKeyPrefix + group\n        )', '(() => { try { return window.sessionStorage.getItem(storageKeyPrefix + group); } catch { return null; } })()'],
      ['window.sessionStorage.setItem(storageKeyPrefix + group, tabParam);', 'try { window.sessionStorage.setItem(storageKeyPrefix + group, tabParam); } catch {}'],
      ['window.sessionStorage.setItem(storageKeyPrefix + group, id);', 'try { window.sessionStorage.setItem(storageKeyPrefix + group, id); } catch {}'],
    ]],
  ]
  const digests = {}
  let changed = 0
  for (const [name, digest, edits] of assets) {
    const file = join(directory, '_static', name)
    if (!existsSync(file)) continue
    const original = readFileSync(file, 'utf8')
    const before = edits.reduce((value, [from, to]) => value.replaceAll(to, from), original)
    if (nativeHash(before) !== digest) throw new Error(`Native widget changed: ${file}`)
    const after = edits.reduce((value, [from, to]) => value.replaceAll(from, to), before)
    digests[name] = nativeHash(after)
    if (after !== original) { writeFileSync(file, after); changed++ }
  }
  return { changed, digests }
}

function exportRegion(html, name) {
  const boundary = (edge) => `<template data-native-boundary="${name}-${edge}"></template>`
  const start = boundary('start'), end = boundary('end')
  if (html.split(start).length !== 2 || html.split(end).length !== 2) throw new Error(`Native export must contain one ${name} region`)
  const from = html.indexOf(start) + start.length, to = html.indexOf(end)
  if (to < from) throw new Error(`Native export ${name} boundaries are reversed`)
  return html.slice(from, to)
}

function compiledChrome(file) {
  const html = readFileSync(file, 'utf8')
  if (!/<html\b[^>]*data-native-shell-export/.test(html)) throw new Error(`Not a native shell export: ${file}`)
  const heads = [...html.matchAll(/<head\b[^>]*data-native-shell-assets[^>]*>([\s\S]*?)<\/head>/g)]
  if (heads.length !== 1) throw new Error(`Native export must contain one asset head: ${file}`)
  return { head: heads[0][1], header: exportRegion(html, 'header'), footer: exportRegion(html, 'footer') }
}

function stripNativeTheme(html, file) {
  return html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (tag, body) => {
    if (!/localStorage\.getItem\(["']theme["']\)/.test(body)) return tag
    const compact = body.replace(/\s+/g, '')
    if (compact === 'document.body.dataset.theme=localStorage.getItem("theme")||"auto";' ||
        compact === '(function(){vart=localStorage.getItem("theme")||"auto";varr=t==="auto"?(window.matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light"):t;document.documentElement.style.colorScheme=r;document.documentElement.classList.add("gp-sphinx-theme-pending");document.documentElement.classList.remove("no-js");functions(){if(document.body&&!document.body.dataset.theme)document.body.dataset.theme=t;}requestAnimationFrame(s);document.addEventListener("DOMContentLoaded",s);})();') return ''
    throw new Error(`Unrecognized native theme bootstrap: ${file}`)
  })
}

function adaptNativePage(html, page, context, chrome, file, assetDigests) {
  if (!/<\/head>/i.test(html)) throw new Error(`Native page has no closing head: ${file}`)
  if (!/<body\b[^>]*>/i.test(html) || !/<\/body>/i.test(html)) throw new Error(`Native page has no body: ${file}`)
  const article = nativeArticle(html)
  if (nativeHash(article) !== page.articleSha256) throw new Error(`Native article changed after context collection: ${page.file}`)
  const contextHash = nativeHash(JSON.stringify(context))
  const alreadyNormalized = html.includes(`data-native-shell="${contextHash}"`)
  if (!alreadyNormalized && nativeHash(html) !== page.htmlSha256) throw new Error(`Native page changed after context collection: ${page.file}`)
  const opening = /<article\b[^>]*>/i.exec(html)
  const afterArticle = opening.index + opening[0].length + article.length
  // Transform only the shell; parsing and serializing the article would rewrite its HTML.
  const transform = (outer) => {
    let result = outer
      .replace(/<!-- libtmux-native-(head|header|footer) -->[\s\S]*?<!-- \/libtmux-native-\1 -->\s*/g, '')
      .replace(/<script\b[^>]*\bsrc=["'][^"']*\/_shell\/shell\.js(?:\?[^"']*)?["'][^>]*>[\s\S]*?<\/script>\s*/gi, '')
      .replace(/<link\b[^>]*\bhref=["'][^"']*\blibtmux-org\.css(?:\?[^"']*)?["'][^>]*>\s*/gi, '')
      .replace(/<style\b[^>]*\bid=["']lt-shell-style["'][^>]*>[\s\S]*?<\/style>\s*/gi, '')
      .replace(/<style\b[^>]*>html\.gp-sphinx-theme-pending[\s\S]*?<\/style>/g, '')
      .replace(/<style\b[^>]*\bid=["']sphinx-fonts["'][^>]*>[\s\S]*?<\/style>/g, '')
      // Older gp-sphinx releases delete this conflicting extension asset but leave its tag.
      .replace(/<script\b[^>]*\bsrc=["']((?:\.\.\/)*_static\/tabs\.js(?:\?[^"']*)?)["'][^>]*>[\s\S]*?<\/script>/gi,
        (tag, src) => existsSync(resolve(dirname(file), src.split('?')[0])) ? tag : '')
      .replace(/<link\b(?=[^>]*\bas=["']font["'])[^>]*>/gi, '')
      .replace(/<header\b[^>]*class=["']mobile-header["'][^>]*>[\s\S]*?<\/header>/g, '')
      .replace(/<button\b[^>]*class=["']theme-toggle["'][^>]*>[\s\S]*?<\/button>/g, '')
      .replace(/<div\b[^>]*class=["']page-source["'][^>]*>[\s\S]*?<\/div>/g, '')
      .replace(/<script\b[^>]*\bsrc=["']((?:[^"']*\/)?_static\/js\/spa-nav\.js(?:\?[^"']*)?)["'][^>]*>[\s\S]*?<\/script>/gi, (_tag, src) => {
        const asset = resolve(dirname(file), src.split('?')[0])
        if (nativeHash(readFileSync(asset)) !== spaNavigationHash) throw new Error(`Native navigation bootstrap changed: ${asset}`)
        return ''
      })
      .replace(/<script\b[^>]*\bsrc=["']((?:[^"']*\/)?_static\/scripts\/furo\.js(?:\?[^"']*)?)["'][^>]*>[\s\S]*?<\/script>/gi, (_tag, src) => {
        const asset = resolve(dirname(file), src.split('?')[0])
        if (nativeHash(readFileSync(asset)) !== furoHash) throw new Error(`Native theme script changed: ${asset}`)
        return ''
      })
    result = stripNativeTheme(result, file)
    result = result.replace(/\bsrc=(["'])((?:[^"']*\/)?_static\/([^/"'?]+\.js))(?:\?[^"']*)?\1/g,
      (attribute, quote, src, name) => assetDigests[name] ? `src=${quote}${src}?v=${assetDigests[name].slice(0, 12)}${quote}` : attribute)
    // ClientRouter compares asset URLs before changing the document location.
    result = result.replace(/\b(src|href)=(["'])(?:\.\.\/)*(_static\/[^"']+)\2/g,
      (_attribute, name, quote, path) => `${name}=${quote}${escapeAttribute(context.base + path)}${quote}`)
    result = result.replace(/\bhref=(["'])(\/[^"']+\.html)\1/g, (attribute, quote, href) => {
      const target = context.pages.find((entry) => `/${entry.path?.replace(/\/$/, '')}.html` === href)
      return target ? `href=${quote}${escapeAttribute(target.url)}${quote}` : attribute
    })
    return result
  }
  let before = transform(html.slice(0, opening.index))
  let after = transform(html.slice(afterArticle))
  before = before.replace(/<html\b([^>]*)>/i, (_tag, attributes) => {
    const clean = attributes.replace(/\sdata-(?:native-shell|native-toc|theme|brand|brand-variant|shell-base)(?=[=\s]|$)(?:=["'][^"']*["'])?/gi, '')
    const brand = PORT_BY_SLUG[context.port].logoLanguage
    return `<html${clean} data-native-shell="${contextHash}" data-theme="${brand}" data-brand="${brand}" data-brand-variant="library" data-shell-base="${escapeAttribute(context.base)}" data-native-toc="${Boolean(page.hasTableOfContents)}">`
  })
  before = before
    .replace(/<\/head>/i, `<!-- libtmux-native-head -->${chrome.head}<!-- /libtmux-native-head -->\n</head>`)
    .replace(/<body\b([^>]*)>\s*/i, (_tag, attributes) => `<body${attributes.replace(/\sdata-documentation-layout=["'][^"']*["']/gi, '')} data-documentation-layout="reference">\n<!-- libtmux-native-header -->${chrome.header}<!-- /libtmux-native-header -->\n`)
    .replace(/<aside class="sidebar-drawer"(?: id="native-navigation")?>/, '<aside class="sidebar-drawer" id="native-navigation">')
  after = after
    .replace(/<aside class="toc-drawer"(?: id="native-toc")?>/, '<aside class="toc-drawer" id="native-toc">')
    .replace(/\s*<\/body>/i, `\n<!-- libtmux-native-footer -->${chrome.footer}<!-- /libtmux-native-footer -->\n</body>`)
  const attributes = opening[0].replace(/\sdata-pagefind-(?:body|filter)(?:=["'][^"']*["'])?/gi, '').replace(/>$/, ` data-pagefind-body data-pagefind-filter="port:${PORT_BY_SLUG[context.port].name}">`)
  const result = before + attributes + article + after
  if (nativeArticle(result) !== article) throw new Error(`Native article was modified: ${page.file}`)
  return result
}

/**
 * Normalize native asset URLs and splice the compiled shared shell around opaque articles.
 * @param {string} directory
 * @param {string} prefix
 * @param {{ sphinxPort?: string, version?: string, contextFile?: string, shellDirectory?: string }} [options]
 */
export async function normalizeNativeShell(directory, prefix, { sphinxPort, version = 'latest', contextFile, shellDirectory } = {}) {
  const port = sphinxPort ? PORT_BY_SLUG[sphinxPort] : undefined
  if (sphinxPort && port?.renderer !== 'sphinx') throw new Error(`Not a Sphinx port: ${sphinxPort}`)
  const root = prefix.replace(/\/+$/, '')
  const context = contextFile ? JSON.parse(readFileSync(contextFile, 'utf8')) : undefined
  if (context && (context.port !== sphinxPort || context.version !== version || context.root !== `${root}/`)) {
    throw new Error('Native context does not match the assembly identity')
  }
  const pages = new Map(context?.pages.map((page) => [page.file, page]) ?? [])
  const seen = new Set()
  const normalize = (content) => content.replace(/(['"(])(?:https?:\/\/libtmux\.org)?\/_shell\//g, `$1${root}/_shell/`)
  let changed = context ? adaptHighlight(directory) : 0
  const widgets = context ? adaptWidgets(directory) : { changed: 0, digests: {} }
  changed += widgets.changed
  const highlightFile = join(directory, '_static/sphinx_highlight.js')
  const highlightDigest = context && existsSync(highlightFile) ? nativeHash(readFileSync(highlightFile)) : undefined
  const assetDigests = { ...widgets.digests, 'sphinx_highlight.js': highlightDigest }
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== '_sources') walk(path)
      } else if (/\.(html|css)$/.test(entry.name)) {
        const before = readFileSync(path, 'utf8')
        const name = relative(directory, path).split(sep).join('/')
        let after = before
        if (port && /^search(?:\.html|\/index\.html)$/.test(name)) {
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
        } else if (port && entry.name.endsWith('.html') && !/<meta\b[^>]*http-equiv=["']refresh["']/i.test(before)) {
          const page = pages.get(name)
          if (!page || !shellDirectory) throw new Error(`Native page has no compiled context: ${name}`)
          seen.add(name)
          after = adaptNativePage(before, page, context, compiledChrome(join(shellDirectory, 'api', name)), path, assetDigests)
        } else {
          after = normalize(before)
        }
        if (after !== before) {
          writeFileSync(path, after)
          changed++
        }
      }
    }
  }
  walk(directory)
  for (const page of pages.keys()) if (!seen.has(page)) throw new Error(`Native context page was not assembled: ${page}`)
  return changed
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, prefix, sphinxPort, version, contextFile, shellDirectory] = process.argv.slice(2)
  if (!directory || !prefix?.startsWith('/')) {
    throw new Error('Usage: normalize-native-shell.mjs DIRECTORY PREFIX [SPHINX_PORT VERSION CONTEXT SHELL_DIRECTORY]')
  }
  console.log(`Native shell: prepared ${await normalizeNativeShell(directory, prefix, { sphinxPort, version, contextFile, shellDirectory })} HTML/CSS files`)
}
