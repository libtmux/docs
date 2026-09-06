import { rehypeHeadingIds, unified } from '@astrojs/markdown-remark'
import mdx from '@astrojs/mdx'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, fontProviders } from 'astro/config'
import { DEFAULT_LOCALE, LOCALES } from './src/i18n/locales.ts'
import expressiveCode from 'astro-expressive-code'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import { apiDb } from './src/integrations/api-db'
import { pagefind } from './src/integrations/pagefind'
import { remarkPortCode } from './src/plugins/remark-port-code.mjs'
import { rehypeSiteRoot } from './src/plugins/rehype-site-root.mjs'
import { rehypeCodeTabs } from './src/plugins/rehype-code-tabs.mjs'
import { danglingReport } from './src/integrations/dangling-report'
import { inventory } from './src/integrations/inventory'
import { rehypeApiLinks } from './src/plugins/rehype-api-links'

/**
 * Every build targets one version. CI supplies these; a bare `pnpm dev`
 * falls back to a root-mounted trunk build so the site is browsable with no
 * environment set at all.
 *
 *   LIBTMUX_DOCS_VERSION       'latest' | 'stable' | 'v0.46.2' | 'v0.x' | 'pr-123'
 *   LIBTMUX_DOCS_VERSION_KIND  'trunk' | 'tag' | 'branch' | 'pr' | 'alias'
 *   LIBTMUX_DOCS_IS_DEFAULT    'true' on the one build that may be indexed
 *   LIBTMUX_DOCS_BASE          override the URL base; defaults to '/'
 *   LIBTMUX_DOCS_SITE          origin, for canonical/sitemap absolute URLs
 */
const env = process.env
const base = env.LIBTMUX_DOCS_BASE ?? '/'
const site = env.LIBTMUX_DOCS_SITE ?? 'https://libtmux.org'
const isDefaultBuild = env.LIBTMUX_DOCS_IS_DEFAULT === 'true'
const versionKind = env.LIBTMUX_DOCS_VERSION_KIND ?? 'trunk'

// Only the root shell build contributes a sitemap.
//
// IS_DEFAULT alone is not enough: it is true for each port's default version
// too, so every port emitted a sitemap advertising its own copy of the shared
// prose — the very URLs Seo.astro marks noindex and canonicalises back to the
// root. A sitemap that lists pages we tell crawlers to ignore is worse than
// no sitemap, so require the root mount as well.
// Not `base === '/'`: the root build's own base gains a locale prefix.
/**
 * Whether a URL is a placeholder standing in for a translation.
 *
 * Every page answers in every locale, but a placeholder carries no content of
 * its own — it is `noindex` and canonical to the English page, so listing it
 * would be a sitemap contradicting the robots tag on what it lists, the exact
 * bug the root-build condition below already fixed once.
 *
 * Decided from the content tree rather than from the render: a translation is
 * a file under `src/content/docs/<locale>/`, so its absence is the whole
 * definition of a placeholder and needs no second source.
 */
const contentRoot = fileURLToPath(new URL('./src/content/docs/', import.meta.url))
const translated = new Set<string>()
for (const locale of LOCALES.filter((l) => l !== DEFAULT_LOCALE)) {
  const dir = join(contentRoot, locale)
  if (!existsSync(dir)) continue
  const walk = (base: string, prefix: string) => {
    for (const name of readdirSync(base)) {
      const child = join(base, name)
      if (statSync(child).isDirectory()) walk(child, `${prefix}${name}/`)
      else translated.add(`${locale}/${prefix}${name}`.replace(/\.mdx?$/, '').replace(/\/index$/, ''))
    }
  }
  walk(dir, '')
}

const isPlaceholder = (page: string): boolean => {
  const path = new URL(page).pathname.replace(/^\/+|\/+$/g, '')
  const [first] = path.split('/')
  if (!LOCALES.includes(first as never) || first === DEFAULT_LOCALE) return false
  return !translated.has(path)
}

const isRootBuild = !env.LIBTMUX_DOCS_PORT
const wantSitemap = isDefaultBuild && isRootBuild && versionKind !== 'pr'

export default defineConfig({
  site,
  base,
  output: 'static',
  // Trailing slashes keep the CloudFront directory-index function simple:
  // one rule, every URL ends in '/', no per-generator special cases.
  trailingSlash: 'always',
  build: { format: 'directory' },

  integrations: [
    inventory(),
    danglingReport(),
    // Before everything: pages query the projection from `getStaticPaths`,
    // which runs before any build hook.
    apiDb(),
    expressiveCode(),
    mdx(),
    ...(wantSitemap
      ? [
          sitemap({
            filter: (page) =>
              !page.includes('/pr-') && !page.includes('/demo') && !isPlaceholder(page),
          }),
        ]
      : []),
    pagefind(),
  ],

  fonts: [
    {
      name: 'IBM Plex Sans',
      cssVariable: '--font-ibm-plex-sans',
      provider: fontProviders.local(),
      fallbacks: ['ui-sans-serif', 'system-ui', 'sans-serif', 'Apple Color Emoji', 'Segoe UI Emoji'],
      optimizedFallbacks: true,
      options: {
        // The same twenty faces gp-sphinx serves: five weights of each family,
        // upright and italic.
        //
        // Six were declared — one weight of the monospace, no italic at all —
        // so a signature name at weight 700 and a parameter name in italic
        // were both synthesised by the browser from the 400 upright. Synthetic
        // bold smears a monospace face and synthetic oblique shears it, which
        // is what "the fonts look blurred" was.
        //
        // `display: block`, also matching. A reference is read rather than
        // skimmed, and a repaint that reflows every signature mid-read costs
        // more than the few hundred milliseconds swapping saves.
        // Spelled out rather than mapped: the fonts API types `variants` as a
        // non-empty tuple, and .map() widens to a plain array.
        variants: [
          {
            src: ['node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-300-normal.woff2'],
            weight: 300,
            style: 'normal' as const,
            display: 'block' as const,
          },
          {
            src: ['node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-300-italic.woff2'],
            weight: 300,
            style: 'italic' as const,
            display: 'block' as const,
          },
          {
            src: ['node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2'],
            weight: 400,
            style: 'normal' as const,
            display: 'block' as const,
          },
          {
            src: ['node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-italic.woff2'],
            weight: 400,
            style: 'italic' as const,
            display: 'block' as const,
          },
          {
            src: ['node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2'],
            weight: 500,
            style: 'normal' as const,
            display: 'block' as const,
          },
          {
            src: ['node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-italic.woff2'],
            weight: 500,
            style: 'italic' as const,
            display: 'block' as const,
          },
          {
            src: ['node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2'],
            weight: 600,
            style: 'normal' as const,
            display: 'block' as const,
          },
          {
            src: ['node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-italic.woff2'],
            weight: 600,
            style: 'italic' as const,
            display: 'block' as const,
          },
          {
            src: ['node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff2'],
            weight: 700,
            style: 'normal' as const,
            display: 'block' as const,
          },
          {
            src: ['node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-italic.woff2'],
            weight: 700,
            style: 'italic' as const,
            display: 'block' as const,
          },
        ] as const,
      },
    },
    {
      name: 'IBM Plex Mono',
      cssVariable: '--font-ibm-plex-mono',
      provider: fontProviders.local(),
      fallbacks: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      optimizedFallbacks: true,
      options: {
        variants: [
          {
            src: ['node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-300-normal.woff2'],
            weight: 300,
            style: 'normal' as const,
            display: 'block' as const,
          },
          {
            src: ['node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-300-italic.woff2'],
            weight: 300,
            style: 'italic' as const,
            display: 'block' as const,
          },
          {
            src: ['node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2'],
            weight: 400,
            style: 'normal' as const,
            display: 'block' as const,
          },
          {
            src: ['node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-italic.woff2'],
            weight: 400,
            style: 'italic' as const,
            display: 'block' as const,
          },
          {
            src: ['node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2'],
            weight: 500,
            style: 'normal' as const,
            display: 'block' as const,
          },
          {
            src: ['node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-italic.woff2'],
            weight: 500,
            style: 'italic' as const,
            display: 'block' as const,
          },
          {
            src: ['node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2'],
            weight: 600,
            style: 'normal' as const,
            display: 'block' as const,
          },
          {
            src: ['node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-italic.woff2'],
            weight: 600,
            style: 'italic' as const,
            display: 'block' as const,
          },
          {
            src: ['node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-700-normal.woff2'],
            weight: 700,
            style: 'normal' as const,
            display: 'block' as const,
          },
          {
            src: ['node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-700-italic.woff2'],
            weight: 700,
            style: 'italic' as const,
            display: 'block' as const,
          },
        ] as const,
      },
    },
  ],

  markdown: {
    // Astro 7 defaults Markdown to the native Sätteri engine, which runs no
    // remark/rehype plugins. unified() opts back into the remark pipeline so
    // heading IDs and anchor links keep working.
    processor: unified({
      // Runs before expressive-code's own transform, so a fence dropped here
      // is never highlighted or emitted at all.
      remarkPlugins: [remarkPortCode],
      rehypePlugins: [
        rehypeHeadingIds,
        rehypeSiteRoot,
        // Before expressive-code, like everything in this processor — so the
        // fences are still plain `pre > code.language-*`. Wrapping them here
        // is what lets expressive-code render inside the panels.
        rehypeCodeTabs,
        // After the tab grouping, before the autolinker: the tables it reads
        // are untouched by both, and running last keeps its <a> wrappers out
        // of the heading-anchor pass.
        rehypeApiLinks,
        [
          rehypeAutolinkHeadings,
          {
            behavior: 'append',
            properties: { className: ['anchor-link'], ariaLabel: 'Link to this section' },
            content: [
              { type: 'element', tagName: 'span', properties: { className: ['sr-only'] }, children: [{ type: 'text', value: 'Link to section' }] },
            ],
          },
        ],
      ],
    }),
  },

  prefetch: { defaultStrategy: 'viewport', prefetchAll: true },
  compressHTML: true,
  server: { port: 4321 },

  vite: {
    resolve: { tsconfigPaths: false, noExternal: ['@tailwindcss/typography'] },
    plugins: [tailwindcss() as never],
  },
})
