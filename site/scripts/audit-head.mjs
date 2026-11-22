#!/usr/bin/env node
/**
 * On-demand audit of every page's head: title, description, canonical,
 * robots, Open Graph, Twitter, icons, manifest, alternates and whether a
 * sitemap lists the page. Not a CI gate and not wired into any test loop.
 *
 *   node site/scripts/audit-head.mjs [options]
 *
 *   --base URL          Origin the pages are served from. Default https://libtmux.org.
 *   --sitemap URL|FILE  A sitemap or sitemap index; repeat for several. Default:
 *                       the Sitemap lines of BASE/robots.txt (or of DIST/robots.txt).
 *   --dist DIR          A built tree (`_site/`): pages come from its index.html
 *                       files and heads are read from disk. Use it to find pages
 *                       that exist but no sitemap lists.
 *   --urls FILE         Extra page URLs, one per line.
 *   --include REGEX     Keep pages whose path matches.
 *   --exclude REGEX     Drop pages whose path matches.
 *   --sample N          Keep about N pages, evenly spread over the sorted list.
 *   --assets MODE       live (request every icon, manifest and social image),
 *                       dist (look them up under --dist) or off.
 *                       Default: dist with --dist, otherwise live.
 *   --concurrency N     Parallel requests, 1 to 8. Default 4.
 *   --delay-ms N        Least gap between two request starts. Default 100.
 *   --out DIR           Where to write the reports. Default ./head-audit.
 *   --format LIST       json, md, html. Default json,md.
 *   --examples N        Examples per rule in the Markdown report. Default 8.
 *   --list              Print the pages the run would read, then stop.
 *
 * Production safety: GET and HEAD only, never more than --concurrency requests
 * in flight, a User-Agent that names this repository, retry with backoff on
 * 429 and 5xx, and a page is read only up to its `</head>`.
 *
 * Examples:
 *   node site/scripts/audit-head.mjs --sample 400 --out /tmp/audit
 *   node site/scripts/audit-head.mjs --dist _site --out /tmp/audit-local
 *   node site/scripts/audit-head.mjs --include '^/en/ts/' --format json,md,html
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { LOCALES } from '../src/i18n/locales.ts'
import { assetsOf, audit, parseHead, renderHtml, renderMarkdown, RULES, sitemapFindings } from './audit-head-rules.mjs'

const USER_AGENT = 'libtmux-docs-head-audit/1 (+https://github.com/libtmux/docs; on-demand, bounded)'
const HEAD_LIMIT = 1 << 20
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** Run jobs with a ceiling on how many are in flight and a floor on the gap between starts. */
export function createLimiter(concurrency, gapMs) {
  let active = 0
  let nextStart = 0
  const queue = []
  const pump = () => {
    while (active < concurrency && queue.length) {
      const { job, resolve: done, reject } = queue.shift()
      active += 1
      const slot = Math.max(Date.now(), nextStart)
      nextStart = slot + gapMs
      sleep(slot - Date.now()).then(job).then(done, reject).finally(() => { active -= 1; pump() })
    }
  }
  return (job) => new Promise((done, reject) => { queue.push({ job, resolve: done, reject }); pump() })
}

/** A request with a timeout, and backoff on 429, 5xx and network failure. */
async function request(url, { method = 'GET', redirect = 'manual', accept = '*/*' } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(url, { method, redirect, headers: { 'user-agent': USER_AGENT, accept }, signal: AbortSignal.timeout(30_000) })
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        const wait = Number(response.headers.get('retry-after')) || 2 ** attempt
        await response.body?.cancel()
        await sleep(Math.min(wait, 30) * 1000)
        continue
      }
      return response
    } catch (error) {
      if (attempt >= 2) return { status: 0, error: String(error?.cause?.code ?? error?.message ?? error), headers: new Headers(), body: null }
      await sleep(1000 * 2 ** attempt)
    }
  }
}

/** The text of a response up to and including its `</head>`; the rest is cancelled unread. */
async function readHead(response) {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
    if (/<\/head\s*>/i.test(text) || text.length > HEAD_LIMIT) break
  }
  await reader.cancel().catch(() => {})
  return text
}

const { values: options } = parseArgs({
  options: {
    base: { type: 'string', default: 'https://libtmux.org' },
    sitemap: { type: 'string', multiple: true },
    dist: { type: 'string' },
    urls: { type: 'string' },
    include: { type: 'string' },
    exclude: { type: 'string' },
    sample: { type: 'string' },
    assets: { type: 'string' },
    concurrency: { type: 'string', default: '4' },
    'delay-ms': { type: 'string', default: '100' },
    out: { type: 'string', default: 'head-audit' },
    format: { type: 'string', default: 'json,md' },
    examples: { type: 'string', default: '8' },
    list: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
})
if (options.help) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^[/ *]+/gm, ''))
  process.exit(0)
}

const base = options.base.replace(/\/+$/, '')
const dist = options.dist ? resolve(options.dist) : undefined
const concurrency = Math.min(8, Math.max(1, Number(options.concurrency) || 4))
const limit = createLimiter(concurrency, Math.max(0, Number(options['delay-ms']) || 0))
const assetMode = options.assets ?? (dist ? 'dist' : 'live')
if (!['live', 'dist', 'off'].includes(assetMode)) throw new Error(`--assets takes live, dist or off, not ${assetMode}`)
if (assetMode === 'dist' && !dist) throw new Error('--assets dist needs --dist')

/** A built file for a URL under this origin. */
function distFile(url) {
  const parsed = new URL(url, base)
  if (parsed.origin !== new URL(base).origin) return undefined
  const path = decodeURIComponent(parsed.pathname).replace(/^\/+/, '')
  const file = resolve(dist, path)
  return file.startsWith(dist) ? file : undefined
}

/** Sitemap XML for a URL: from the built tree when there is one, else over HTTP. */
async function readSitemapText(url) {
  if (dist) {
    const file = distFile(url)
    return file && existsSync(file) ? { status: 200, text: readFileSync(file, 'utf8') } : { status: 404, text: '' }
  }
  const response = await limit(() => request(url, { redirect: 'follow', accept: 'application/xml,text/xml' }))
  return { status: response.status, text: response.status === 200 ? await response.text() : (await response.body?.cancel(), '') }
}

const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((match) => match[1].replace(/&amp;/g, '&'))

/** Every URL a sitemap tree lists, and each sitemap file's own status. */
async function readSitemaps(roots) {
  const sitemaps = []
  const urls = new Set()
  const seen = new Set()
  const walk = async (url, depth) => {
    if (seen.has(url) || depth > 3) return
    seen.add(url)
    const { status, text } = await readSitemapText(url)
    const entry = { url, status, urls: 0 }
    sitemaps.push(entry)
    if (status !== 200) return
    if (/<sitemapindex[\s>]/.test(text)) {
      for (const child of locs(text)) await walk(child, depth + 1)
    } else {
      for (const loc of locs(text)) { urls.add(loc); entry.urls += 1 }
    }
  }
  for (const root of roots) await walk(root, 0)
  return { sitemaps, urls }
}

async function advertisedSitemaps() {
  if (options.sitemap?.length) return options.sitemap.map((entry) => (existsSync(entry) ? new URL(`file://${resolve(entry)}`).href : entry))
  const robots = dist
    ? (existsSync(join(dist, 'robots.txt')) ? readFileSync(join(dist, 'robots.txt'), 'utf8') : '')
    : (await readSitemapText(`${base}/robots.txt`)).text
  const lines = [...robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((match) => match[1])
  if (lines.length) return lines
  // A built tree has no root robots.txt when one locale was built alone.
  return LOCALES.map((locale) => `${base}/${locale}/sitemap-index.xml`)
}

/** Every `index.html` under a built tree, as the URL it is served at. */
function distPages() {
  const found = []
  // `demo` is Disallowed in robots.txt and kept out of every sitemap; the audit reads what a crawler may.
  const skip = /^(?:_astro|_static|_sources|_images|_shell|pagefind|brand|demo|\.build-logs|node_modules)$/
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) { if (!skip.test(entry.name)) walk(path) } else if (entry.name === 'index.html') {
        found.push(`${base}/${relative(dist, dir).split('\\').join('/')}/`.replace(/\/\/$/, '/'))
      }
    }
  }
  walk(dist)
  return found
}

const sitemapRoots = await advertisedSitemaps()
const { sitemaps, urls: sitemapUrls } = await readSitemaps(sitemapRoots)
const listed = new Set([...sitemapUrls].map((url) => url.replace(/^http:/, 'https:')))
for (const sitemap of sitemaps) {
  if (sitemap.status !== 200) console.error(`sitemap ${sitemap.url} answered ${sitemap.status}`)
}

let pageUrls = dist ? distPages() : [...listed]
if (options.urls) pageUrls.push(...readFileSync(options.urls, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean))
pageUrls = [...new Set(pageUrls)].sort()
if (options.include) pageUrls = pageUrls.filter((url) => new RegExp(options.include).test(new URL(url).pathname))
if (options.exclude) pageUrls = pageUrls.filter((url) => !new RegExp(options.exclude).test(new URL(url).pathname))
const sample = Number(options.sample)
if (sample > 0 && pageUrls.length > sample) {
  const stride = pageUrls.length / sample
  pageUrls = Array.from({ length: sample }, (_, i) => pageUrls[Math.floor(i * stride)])
}
console.error(`${pageUrls.length} pages, ${listed.size} sitemap URLs from ${sitemaps.length} sitemaps, concurrency ${concurrency}`)
if (options.list) {
  // Exit after the write drains: a pipe takes a long list in pieces.
  await new Promise((done) => process.stdout.write(`${pageUrls.join('\n')}\n`, done))
  process.exit(0)
}
if (!pageUrls.length) {
  console.error('No pages to read: pass --sitemap, --dist or --urls.')
  process.exit(1)
}

/** One page: its status, redirect target and parsed head. */
async function readPage(url) {
  if (dist) {
    const file = join(distFile(url) ?? '', 'index.html')
    if (!existsSync(file)) return { url, status: 404 }
    const html = readFileSync(file, 'utf8').slice(0, HEAD_LIMIT)
    return { url, status: 200, head: parseHead(html) }
  }
  const response = await limit(() => request(url, { accept: 'text/html' }))
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {})
    return { url, status: response.status, location: response.headers.get('location') }
  }
  if (!(response.headers.get('content-type') ?? '').includes('html')) {
    await response.body?.cancel().catch(() => {})
    return { url, status: 200, head: null, note: `content-type ${response.headers.get('content-type')}` }
  }
  return { url, status: 200, head: parseHead(await readHead(response)) }
}

const pages = []
let next = 0
await Promise.all(Array.from({ length: concurrency }, async () => {
  for (;;) {
    const index = next++
    if (index >= pageUrls.length) return
    pages[index] = await readPage(pageUrls[index])
    if ((index + 1) % 250 === 0) console.error(`  ${index + 1}/${pageUrls.length}`)
  }
}))

/** Status of an asset or alternate: a built file, an HTTP HEAD, or nothing when off. */
const statuses = new Map(pages.map((page) => [page.url, page.status]))
async function statusOf(url) {
  if (statuses.has(url)) return statuses.get(url)
  let status
  if (assetMode === 'dist') {
    const file = distFile(url)
    const target = file && existsSync(file) && statSync(file).isDirectory() ? join(file, 'index.html') : file
    status = target && existsSync(target) ? 200 : (new URL(url).origin === new URL(base).origin ? 404 : undefined)
  } else if (assetMode === 'live') {
    status = await limit(async () => {
      let response = await request(url, { method: 'HEAD', redirect: 'follow' })
      if (response.status === 405 || response.status === 501) {
        response = await request(url, { redirect: 'follow' })
        await response.body?.cancel().catch(() => {})
      }
      return response.status
    })
  }
  statuses.set(url, status)
  return status
}

if (assetMode !== 'off') {
  const wanted = new Set()
  for (const page of pages) {
    if (!page.head) continue
    for (const { url } of assetsOf(page.head, page.url)) wanted.add(url)
    for (const alternate of page.head.alternates) if (alternate.hreflang) wanted.add(new URL(alternate.href, page.url).href)
  }
  console.error(`checking ${wanted.size} icon, manifest, image and alternate URLs`)
  await Promise.all([...wanted].map(statusOf))
  for (const page of pages) {
    if (!page.head) continue
    page.assets = Object.fromEntries(assetsOf(page.head, page.url).map(({ url }) => [url, statuses.get(url)]).filter(([, status]) => status !== undefined))
    page.alternateStatus = Object.fromEntries(page.head.alternates.filter((alternate) => alternate.hreflang)
      .map((alternate) => [alternate.href, statuses.get(new URL(alternate.href, page.url).href)]).filter(([, status]) => status !== undefined))
  }
}

const { results, byRule } = audit(pages, { sitemap: sitemaps.length ? listed : null })
for (const { url, rule, severity } of sitemapFindings(sitemaps)) {
  const entry = (byRule[rule] ??= { severity, count: 0, examples: [] })
  entry.count += 1
  entry.examples.push(url)
}

const report = {
  schema: 1,
  meta: {
    base,
    generatedAt: new Date().toISOString(),
    source: dist ? { dist: '(built tree)' } : { sitemaps: sitemapRoots },
    assets: assetMode,
    sitemaps,
  },
  rules: Object.fromEntries(Object.entries(RULES).map(([rule, [severity, description]]) => [rule, { severity, description }])),
  summary: { pages: results.length, byRule },
  results,
}

const out = resolve(options.out)
mkdirSync(out, { recursive: true })
const formats = new Set(options.format.split(',').map((format) => format.trim()))
if (formats.has('json')) writeFileSync(join(out, 'head-audit.json'), `${JSON.stringify(report)}\n`)
if (formats.has('md')) writeFileSync(join(out, 'head-audit.md'), renderMarkdown(report, { examples: Number(options.examples) || 8 }))
if (formats.has('html')) writeFileSync(join(out, 'head-audit.html'), renderHtml(report))

const width = Math.max(...Object.keys(byRule).map((rule) => rule.length), 4)
console.log(`${results.length} pages read; reports in ${out}`)
for (const [rule, entry] of Object.entries(byRule).sort((a, b) => b[1].count - a[1].count)) {
  console.log(`${String(entry.count).padStart(6)}  ${entry.severity.padEnd(5)}  ${rule.padEnd(width)}  ${entry.examples.slice(0, 2).map((url) => (url.startsWith('http') ? new URL(url).pathname : url)).join('  ')}`)
}
