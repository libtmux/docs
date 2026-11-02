#!/usr/bin/env node
/**
 * Write the sitemap of one finished port tree.
 *
 * usage: gen-port-sitemap.mjs TREE PUBLIC_URL
 *   TREE        the port's version tree, e.g. _site/en/ts/latest
 *   PUBLIC_URL  where that tree is served, e.g. https://libtmux.org/en/ts/latest/
 *
 * The shell's own sitemap comes from the shell build, which renders only some
 * of a port's pages: the language home, any page that only the port's build
 * renders, and a native Sphinx tree are all outside it. The port's publisher
 * owns its tree, so the tree carries its own sitemap and the shell's index
 * names it. Pages come from the finished files, so Astro and native pages are
 * treated alike, and each page's head decides whether it is listed
 * (`headVerdict`).
 *
 * Writes `sitemap-0.xml` and `sitemap-index.xml` into TREE. One file only: the
 * shell's index names `sitemap-0.xml` without knowing the port, so a tree over
 * the protocol's limit fails here instead of silently losing pages.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { headVerdict } from '../site/src/lib/sitemap-heads.ts'

/** The sitemap protocol allows 50,000 URLs per file. */
export const LIMIT = 50_000
const NOT_PAGES = /^(?:_astro|_static|_sources|_images|_shell|pagefind|brand|\.build-logs|node_modules)$/
const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const XML = '<?xml version="1.0" encoding="UTF-8"?>'

/** Every listed page under a tree as `{ url, skipped }`: its URL, and the pages its own head excluded. */
export function treePages(tree, publicUrl) {
  const root = publicUrl.endsWith('/') ? publicUrl : `${publicUrl}/`
  const urls = []
  const skipped = { noindex: 0, redirect: 0, canonical: 0 }
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) { if (!NOT_PAGES.test(entry.name)) walk(join(dir, entry.name)) } else if (entry.name === 'index.html') {
        const path = relative(tree, dir).split('\\').join('/')
        const url = new URL(path ? `${path}/` : '', root).href
        const verdict = headVerdict(readFileSync(join(dir, entry.name), 'utf8'), url)
        if (verdict.listed) urls.push(url)
        else skipped[verdict.reason] += 1
      }
    }
  }
  walk(tree)
  return { urls: urls.sort(), skipped }
}

export function writePortSitemap(tree, publicUrl, limit = LIMIT) {
  const { urls, skipped } = treePages(tree, publicUrl)
  if (urls.length > limit) throw new Error(`gen-port-sitemap: ${urls.length} pages under ${tree} exceed the ${limit}-URL sitemap file`)
  const root = publicUrl.endsWith('/') ? publicUrl : `${publicUrl}/`
  writeFileSync(join(tree, 'sitemap-0.xml'), `${XML}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${escape(url)}</loc></url>`).join('')}</urlset>`)
  writeFileSync(join(tree, 'sitemap-index.xml'), `${XML}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${escape(new URL('sitemap-0.xml', root).href)}</loc></sitemap></sitemapindex>`)
  return { urls: urls.length, skipped }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [tree, publicUrl] = process.argv.slice(2)
  if (!tree || !publicUrl) throw new Error('Usage: gen-port-sitemap.mjs TREE PUBLIC_URL')
  const { urls, skipped } = writePortSitemap(resolve(tree), publicUrl)
  console.log(`sitemap: ${urls} pages listed under ${tree} (kept out: ${skipped.noindex} noindex, ${skipped.redirect} redirects, ${skipped.canonical} canonical elsewhere)`)
}
