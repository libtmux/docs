#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { branding, jsonLd } from '../site/src/lib/branding.ts'
import { PORT_BY_SLUG } from '../site/src/lib/ports.ts'

const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** Add crawler-visible artwork while preserving native canonical/robots policy. */
export function nativeBrandHead(html, { port, pagePath, root = '/en' }) {
  if (!/<head[\s>]/i.test(html) || /http-equiv=["']refresh["']/i.test(html)) return html
  const brand = branding(port, pagePath, root)
  const origin = 'https://libtmux.org'
  const image = new URL(brand.asset('opengraph-light.png'), origin).href
  const twitter = new URL(brand.asset('twitter-light.png'), origin).href
  const attr = (text) => escape(text)
  const tags = [
    `<link rel="icon" href="${attr(brand.asset('favicon.ico'))}" sizes="16x16 32x32 48x48 256x256">`,
    `<link rel="icon" href="${attr(brand.asset('logo-32.png'))}" type="image/png" sizes="32x32">`,
    `<link rel="icon" href="${attr(brand.asset('logo.svg'))}" type="image/svg+xml" sizes="any">`,
    `<link rel="apple-touch-icon" href="${attr(brand.asset('apple-touch-icon-light.png'))}" sizes="180x180">`,
    `<link rel="mask-icon" href="${attr(brand.asset('safari-pinned-tab.svg'))}" color="${brand.palette.color}">`,
    `<link rel="manifest" href="${attr(brand.asset('site.webmanifest'))}">`,
    `<meta name="theme-color" content="${brand.palette.light.background}" media="(prefers-color-scheme: light)">`,
    `<meta name="theme-color" content="${brand.palette.dark.background}" media="(prefers-color-scheme: dark)">`,
    `<meta name="msapplication-config" content="${attr(brand.asset('browserconfig.xml'))}">`,
    `<meta property="og:image" content="${attr(image)}">`,
    '<meta property="og:image:type" content="image/png">',
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta property="og:image:alt" content="${attr(brand.label)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:image" content="${attr(twitter)}">`,
    `<meta name="twitter:image:alt" content="${attr(brand.label)}">`,
    `<script type="application/ld+json" data-libtmux-brand>${jsonLd({
      '@context': 'https://schema.org', '@type': 'SoftwareSourceCode',
      name: PORT_BY_SLUG[port]?.packageName ?? 'libtmux',
      programmingLanguage: PORT_BY_SLUG[port]?.language ?? 'Python',
      codeRepository: `https://github.com/${PORT_BY_SLUG[port]?.repo ?? 'tmux-python/libtmux'}`,
      image: new URL(brand.asset('logo-512.png'), origin).href,
    })}</script>`,
  ].join('\n')
  const branded = html.replace(/<html\b([^>]*)>/i, (_match, attributes) =>
    `<html${attributes.replace(/\sdata-brand(?:-variant)?=["'][^"']*["']/g, '')} data-brand="${brand.language}" data-brand-variant="${brand.variant}">`)
  return branded.replace(/(<head\b[^>]*>)([\s\S]*?)(<\/head>)/i, (_match, open, head, close) => {
    const clean = head
      .replace(/<link\b[^>]*\brel=["'](?:shortcut icon|icon|apple-touch-icon|mask-icon|manifest)["'][^>]*>/gi, '')
      .replace(/<meta\b[^>]*\b(?:name|property)=["'](?:og:image(?::[a-z_]+)?|twitter:image(?::alt)?|twitter:card|theme-color|msapplication-config)["'][^>]*>/gi, '')
      .replace(/<script\b[^>]*\bdata-libtmux-brand[^>]*>[\s\S]*?<\/script>/gi, '')
    return `${open}${clean.trimEnd()}\n${tags}\n${close}`
  })
}

export function brandNativePages(directory, port, root) {
  let count = 0
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.html')) {
        const before = readFileSync(path, 'utf8')
        const after = nativeBrandHead(before, { port, root, pagePath: relative(directory, path).replaceAll('\\', '/') })
        if (before !== after) { writeFileSync(path, after); count++ }
      }
    }
  }
  walk(directory)
  return count
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, port, root = '/en'] = process.argv.slice(2)
  if (!directory || !PORT_BY_SLUG[port]) throw new Error('Usage: brand-native-pages.mjs DIRECTORY PORT /LOCALE_PREFIX')
  console.log(`Native branding: ${brandNativePages(directory, port, root)} pages`)
}
