import { glob } from 'astro/loaders'
import { defineCollection, z } from 'astro:content'

/**
 * Shell prose. One collection for everything hand-written: the landing page,
 * cross-language concepts, guides, examples and the parity narrative.
 *
 * Per-port reference content does NOT live here. Three ports render their
 * reference through this Astro app from a generated model (TypeScript,
 * .NET, Go); the rest are produced by Sphinx or their own generator and are
 * merged into the output tree by scripts/build-site.sh.
 */
const docs = defineCollection({
  loader: glob({ base: './src/content/docs', pattern: '**/*.{md,mdx}' }),
  schema: z.looseObject({
    title: z.string(),
    description: z.string().optional(),
    /** Restricts a page to one port's section, e.g. 'py'. Omit for shared pages. */
    port: z.string().optional(),
    /** Sidebar placement. */
    sidebar: z
      .object({
        label: z.string().optional(),
        order: z.number().optional(),
        group: z.string().optional(),
      })
      .optional(),
    /** Suppress the on-page table of contents. */
    tableOfContents: z.boolean().default(true),
    /** Explicit canonical override; normally computed. */
    canonical: z.string().optional(),
    /** Keep a page out of the sitemap and set noindex. */
    noindex: z.boolean().default(false),
    /** ISO date, drives Article structured data. */
    updated: z.string().optional(),
    /**
     * Translations only: the commit of the English source this was made from.
     *
     * This is the whole staleness mechanism. A translation declares the sha it
     * was translated at; the next edit to the English page moves it to `stale`
     * without anyone having to remember. See src/i18n/resolve.ts.
     */
    source_commit: z.string().optional(),
    /** Translations only: who or what produced it. */
    translator: z.string().optional(),
    /** Translations only: whether a human has reviewed it. */
    reviewed: z.boolean().optional(),
  }),
})

/**
 * Generated API reference.
 *
 * scripts/build-site.sh runs each self-hosted port's own generator, then
 * copies the Markdown it produces into src/content/api/<port>/ and builds the
 * shell once more with LIBTMUX_DOCS_PORT set, mounted at that port's version
 * prefix. The reference therefore renders through the same layout, theme and
 * search as everything else, without this repo reimplementing any port's
 * extractor.
 */
const api = defineCollection({
  loader: glob({
    base: './src/content/api',
    pattern: '**/*.md',
    /**
     * Keep the staged filename as the id, verbatim.
     *
     * Astro's default `generateId` slugifies, which strips the dots out of a
     * .NET type name: `libtmux.client.md` became `libtmuxclient`, so every
     * cross-reference the staging script wrote (`../libtmux.client/`) 404'd
     * while the build still reported success. Dotted segments are the
     * convention every .NET reference uses, and the CloudFront function
     * resolves them by extension rather than by "contains a dot".
     *
     * `index.md` is folded into its directory so a port whose reference is a
     * single file keeps landing on `/<port>/<version>/api/`, not `/api/index/`.
     */
    generateId: ({ entry }) => entry.replace(/\.md$/, '').replace(/\/index$/, ''),
  }),
  schema: z.looseObject({
    title: z.string(),
    description: z.string().optional(),
    port: z.string(),
    /** Generator that produced this file, shown in the page footer. */
    generator: z.string().optional(),
  }),
})

export const collections = { docs, api }
