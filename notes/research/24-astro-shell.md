# The owned Astro shell

libtmux.org's shell — header, footer, sidebar, table of contents, search, theme,
version switcher, MDX components — is Astro 7 with no documentation framework
underneath it, ported from `~/work/typescript/social-embed/packages/site`, an
already-working owned-Astro site. The shell ports with moderate rework; the
pipeline that has to feed it eight foreign API models does not exist yet.

## 1. The case for owning it

The decision is empirical, not aesthetic: `social-embed.org` ran on Starlight and was
migrated off it. `~/work/typescript/social-embed` carries the trail — `5b1f352a`
replaced `StarlightPage` with a hand-written `BaseLayout`, `96c8b3f9` removed
component overrides, `cfabf5ee` removed the dependencies, and PR #55 (`09ec34f2`,
"Migrate from Starlight to pure Astro") landed the rest. The stated reason was
lock-in — years pinned to someone else's component API and upgrade cadence. Be
honest about what that migration does and does not prove: social-embed is a
single-locale, single-version site covering two packages with no external
generator ingestion. libtmux.org extends it in exactly the three directions that
are hard — many versions, two locales, and ingesting eight foreign API models. The
shell is solved; the pipeline is not, and §4 sizes that gap rather than assuming
it away.

The two things a framework was supposed to buy evaporated under verification. Search
first: Starlight bundles Pagefind "with zero config," but the actual integration
(`plugins/astro-pagefind-integration.ts`, 45 lines) just shells out to the Pagefind
CLI on the `astro:build:done` hook — its own header comment says the pattern is
"borrowed from Starlight's." Owning it costs a file, not a feature. Versioning is
the sharper case: Starlight has none. A changelog search for "versioning" across
3,017 lines returns zero matches, and the only mitigation, `starlight-versions`, is a
99-star plugin whose own README calls itself early development. A framework that
doesn't solve the one problem libtmux.org's shell most needs to solve isn't buying
much by being a framework.

The honest counter-argument is real: a framework ships upgrades for free. Starlight's
maintainers track Astro's own release cadence, absorb its breaking changes, and patch
accessibility and i18n bugs upstream. Owning the shell means libtmux.org absorbs that
work itself — and social-embed's component tree shows exactly where it lands: ARIA
roving-`tabindex` in the `Tabs` manager, focus handling and `data-search-modal-open`
bookkeeping in the search `<dialog>`, and `astro:after-swap` listener cleanup
repeated in every mobile panel (`MobileSidebar.astro`, `MobileToC.astro`) so a View
Transitions navigation doesn't leak event handlers. That is real, recurring
maintenance, not a one-time cost.

The answer is narrower than "own everything from scratch": Astro itself — not
Starlight — is still a framework, and it still ships the upgrades that matter for a
docs site. Astro 7's Vite 8/Rolldown pipeline, the Content Layer API, the Fonts API,
and the `satteri` markdown processor all arrive as ordinary `astro` version bumps,
with no plugin-compatibility lag layered on top. What gets dropped is only the layer
Starlight adds *above* Astro — its component API, its theme contract, its i18n
router — the layer whose upgrade cadence was the actual complaint. The Pagefind
integration is the model for the rest of the shell: read the upstream mechanism,
port the fifty-odd lines, own the result.

## 2. The stack

Reading `~/work/typescript/social-embed/packages/site/astro.config.ts` end to end,
each dependency earns a specific job:

| Package | Job |
|---|---|
| `astro` 7.2.7 | Build tool, dev server, routing. Ships Vite 8.2.2, which brings the Rolldown-based bundler transitively (Astro 7.0 shipped 2026-06-22; confirmed in the ledger). |
| `@astrojs/markdown-satteri` | Astro's Rust-based Markdown processor, replacing the old remark/rehype pipeline for `.md` files rendered outside MDX. Ships built-in heading IDs. |
| Two hast plugins (`satteriSkipFirstHeading`, `satteriHeadingAnchors`) | Small, ordered post-processing on `satteri`'s output: drop a duplicated `<h1>` when frontmatter says so, then add GitHub-slugger-compatible heading IDs and hover-anchor links. `satteri` runs them in the order passed, which matters — the skip has to happen before the anchor pass gives the dropped heading an ID. |
| `@astrojs/mdx` | `.mdx` support for pages that need embedded components (`<Tabs>`, `<Aside>`) rather than plain prose. MDX does not go through `satteri` — it has its own compiler pipeline, which is why heading collection for MDX needs a separate fix (below). |
| `@astrojs/react` + `react`/`react-dom` 19 | React only for islands that need real client state — currently just the search modal. |
| `@tailwindcss/vite` (Tailwind 4) | Utility CSS via the Vite plugin, not the old PostCSS pipeline. |
| `astro-expressive-code` | Code block rendering: copy button, line highlighting, per-theme syntax colors keyed off `[data-theme]` via a custom `themeCssSelector`. |
| `pagefindIntegration()` | The 45-line owned Pagefind hook (§1). |
| Astro Fonts API (`fonts: [...]`, `fontProviders.local()`) | Declares font families with explicit variants and local `@fontsource` `.woff2` files — no Google Fonts network fetch, no FOUT-inducing external request. Graduated from experimental in Astro 6.0.4. |
| `vite-plugin-mdx-merge-headings` | Fixes a specific MDX gap: when an `.mdx` page imports and renders a `.md` file as a component (social-embed does this for package READMEs), Astro's heading collector only sees the MDX AST, so the ToC misses the imported file's headings. The plugin rewrites the compiled MDX to merge `getHeadings()` calls. |
| `vite-plugin-local-cdn` | Builds social-embed's own `@social-embed/lib`/`wc` bundles on demand at `/cdn/*.js`. This is social-embed-specific and does not port. |

TypeScript throughout, Biome for lint and format, Vitest for tests — all carry over
unmodified as project tooling, not shell architecture.

## 3. What ports, and what changes

`BaseLayout.astro` and `MarkdownLayout.astro` are the two layouts every page goes
through. `BaseLayout` owns the `<html>` shell, meta tags, the inline theme-flash
script (reads `localStorage`, sets `data-theme` before first paint), font
preloading, and the sticky header built from `CoreHeaderLayout`.
`MarkdownLayout` wraps it with the three-column sidebar/content/ToC grid and the
mobile slide-out panels. Both port with no structural change — the CSS custom
properties (`--nav-height`, `--nav-bg`, `--nav-border`) are already a generic
contract, not social-embed-specific.

`CoreHeaderLayout.astro` is the header skeleton: a flex row with six named
slots (`mobile-toggles`, `logo`, `package-nav`, `nav`, `social`, `theme`). This is
the actual extension seam — libtmux.org needs it unchanged, but needs new content
in three of those slots: a language switcher (which of the eight port prefixes),
the version switcher (§4), and a locale switcher if ledger §3's locale-outermost
shape is read as calling for a header control rather than link-only navigation.
None of that requires touching `CoreHeaderLayout` itself.

What genuinely changes, component by component:

| Component | Ports as-is | What changes for libtmux |
|---|---|---|
| `PureSiteTitle`, `PureSocialIcons`, `PureThemeSelect` | Yes | None beyond swapping the logo asset and repo links. `PureThemeSelect`'s `localStorage` key is `starlight-theme`, kept for social-embed's own backward compatibility; ledger §7.13 leaves the libtmux key unresolved — three options, none picked. Do not silently pick one here. |
| `PureSearchButton` | Yes | None — it already only orchestrates a `<dialog>` and defers to a search island. |
| `PurePackageNav` | Layout pattern only | This is a two-item ribbon (Web Component, Library) that hides its sub-links below 75rem. Eight ports plus four shell sections do not fit a ribbon; it becomes a menu (dropdown or mega-menu), not six more `if` branches bolted onto the same layout. The `package-nav` slot itself needs no change. |
| `Sidebar` + `getSidebarItems` | Mechanism ports, data does not | `Sidebar.astro` scopes itself today with `currentPath.startsWith("/lib/") ? "lib" : currentPath.startsWith("/wc/") ? "wc" : undefined` — two hardcoded prefixes. The fix generalizes this to a data table keyed by section, not more hardcoded branches, and the same table has to drive both the shell's own sectioning (`/concepts/`, `/guides/`, `/examples/`, `/parity/`) and the per-language switcher in the header. A second, separate use appears in §4: three of the eight ports (TypeScript, .NET, Go) render their reference trees as their *own* Astro builds run in their own repos' CI (ledger §7.7), and those satellite builds need this same `Sidebar`/`SidebarSection` pair reused from an imported package rather than copy-pasted — packaging that import is new work, not a data change. |
| `TableOfContents`, `MobileNavToggle`, `MobileSidebar`, `MobileToC` | Yes, verbatim | Pure presentation over `headings`/sidebar-item props; no social-embed-specific assumption anywhere in them. |
| `Aside`, `Badge`, `LinkButton` | Yes | None. |
| `Tabs`/`TabItem` | Yes, and becomes load-bearing | See §6. |
| `usePagefindSearch` + `SearchModal`/`SearchResults`/`SearchResultItem` (React) | Yes | None to the hook itself. The multi-language, multi-version site needs Pagefind's `mergeIndex`/`mergeFilter` API to combine per-language, per-build indexes at query time (confirmed real and documented: `pagefind_web_js/lib/coupled_search.ts`), each with its own `baseUrl` — social-embed runs one bundle and never calls `mergeIndex`. Budget accordingly: a single-site search is Pagefind's own quoted ~100-300KB; an *N*-language merged search is ~164KB runtime (loaded once, shared WASM) plus roughly *N*×28KB of parallel index-chunk fetches, extrapolated from a real measurement against the Python docs (108 pages, 13.2MB HTML → 332KB of index chunks) — not the single-site figure. |
| `pagefindIntegration()` | Yes, verbatim | The three Astro-rendered satellites (TypeScript, .NET, Go) each run their own `astro build`, so each needs its own `pagefind --site <dist>` invocation — the loop already implicit in "one build per prefix" (ledger §2.3), not new plumbing. The five natively-rendered ports (Python, C++, Rust, Java/Kotlin, Swift) are indexed the same way from outside Astro entirely: `pagefind --site <that generator's own output>`, then merged in. |
| `content.config.ts` (`glob()` + `z.looseObject`) | Mechanism ports | The schema needs new optional fields (a `port` tag, a `translatable` flag pending ledger §7.10's unclosed question on translatable guide prose) but the loader itself — `glob()` over `.md`/`.mdx` — is unchanged for hand-authored shell prose. |

## 4. What is genuinely new

Three things have no equivalent in social-embed at all, and none of them are small.

**Multi-version routing and the switcher.** Ledger §2.3 settles that `/stable/` and
`/latest/` are real, separate builds, never S3 copies or CloudFront rewrites — every
tag build sets its own canonical URL. Concretely, each of the three Astro-rendered
satellites is invoked once per version with `base` and the canonical `site` URL
supplied as build inputs, not hardcoded:

```ts
// astro.config.ts — one Astro build per version prefix.
// SHELL_BASE is set by the calling CI job, once per tag/alias build.
import { defineConfig } from "astro/config";

const base = process.env.SHELL_BASE ?? "/ts/latest/api/";

export default defineConfig({
  base,
  site: "https://libtmux.org",
  outDir: `dist${base}`,
  // integrations, markdown, vite config: same as the shell (§2)
});
```

The switcher that reads the result has to be a runtime artifact, not a build-time
list — ledger §6 requires shell chrome to reach already-published immutable
versions without a rebuild, so a version list baked in at build time goes stale the
moment the next tag ships. It fetches a `versions.json` manifest at runtime, parses
`{port}/{version}` out of `location.pathname`, and swaps the version segment. This
cannot assume React: the same switcher has to mount inside rustdoc, Dokka and DocC
pages that have no JavaScript framework at all (§7), which is the strongest argument
for the `Pure*`/vanilla-custom-element convention in §5 over a component library.
The mechanism for shipping that mount point into five foreign generators as a
standalone script — separate bundle, IIFE, IIFE-with-container API — is unresolved
here; it belongs in the shell-contract document that ledger §7.12 names, and §7.1's caveat about
`<script>` execution inside a cloned DocC `<template>` applies directly to it.

**Locale routing.** Ledger §3 fixes the URL shape — locale outermost
(`/ja/concepts/panes/`), reference trees never localized — but explicitly no longer
treats that as a framework constraint, since Starlight's i18n router is gone.
Nothing forces reinventing routing from scratch, either: Astro core ships its own
`i18n` config (locale list, routing strategy, fallback) independent of Starlight,
and is one legitimate option for implementing §3's shape; a hand-rolled
`[locale]/[...slug].astro` catch-all is the other. Choosing between them, and the
translation workflow itself (Weblate, `.po` extraction), is the i18n document's
job (the one ledger §3 sets policy for), not this one's.

**The content-collection loaders.** Astro's Content Layer API (stable since Astro 5,
confirmed in the ledger) is the mechanism: a `Loader` is an object with a `load()`
method that receives a `store` and populates it by calling `store.set({ id, data,
rendered?, body?, filePath? })` per entry; the built-in `file()` loader handles the
easy case — one JSON/YAML file parsed into a flat list or keyed object. Only three
of the eight ports actually need a loader at all, because only three render through
the Astro shell's own build: TypeScript (api-extractor JSON), .NET (docfx YAML),
Go (doc2go HTML fragments). The other five — Python, C++, Rust, Java/Kotlin, Swift —
never enter an Astro collection; their own generator's output is synced as a tree
and skinned at runtime (§7). Sizing three loaders honestly, not eight:

- **.NET**: `docfx metadata --outputFormat ApiPage` emits one YAML file per page,
  with cross-references already resolved to `{text, url}` pairs at generation
  time — no unresolved `xref:` to chase. That shape is close enough to `file()`'s
  assumptions that `glob({ pattern: "**/*.yml" })` over the output directory is
  worth spiking before writing a custom loader.
- **Go**: `doc2go -embed` emits body-only HTML fragments, not JSON — `flags.go:187-191`
  hard-errors if `-pagefind` is combined with `-embed`, so Go loses doc2go's native
  search and rides the site-wide Pagefind crawl instead. The loader here is a thin
  wrapper: read each fragment file, call `store.set()` with the raw HTML in
  `rendered.html` so `render(entry)` in a page returns a working `<Content />`, no
  parsing needed since there is no structure to parse.
- **TypeScript** needs the real custom loader, because api-extractor's JSON is a
  936,568-byte nested `ApiItem` tree, not a flat list `file()` can walk, and it
  ships as *four* separate `.api.json` files, not one — `packages/libtmux/dist/index.d.ts`
  re-exports only 10 of 13 non-root subpaths, so `engine`, `field-types` and
  `formats` each need their own api-extractor config or three of fourteen public
  entry points silently vanish from the docs:

```ts
// loaders/api-extractor-loader.ts — sketch, not yet run against real output.
import { ApiModel, ApiItem } from "@microsoft/api-extractor-model";
import type { Loader } from "astro/loaders";

const API_JSON_FILES = ["index", "engine", "field-types", "formats"];

export function apiExtractorLoader(dir: string): Loader {
  return {
    name: "api-extractor-loader",
    load: async ({ store, generateDigest, logger }) => {
      store.clear();
      for (const name of API_JSON_FILES) {
        const model = new ApiModel();
        const pkg = model.loadPackage(`${dir}/${name}.api.json`);

        const walk = (item: ApiItem) => {
          const ref = item.canonicalReference.toString();
          store.set({
            id: `${name}/${ref}`,
            data: {
              kind: item.kind,
              name: item.displayName,
              // structured data, not pre-rendered HTML — a shared
              // Astro page template renders signatures/params/members,
              // matching the "own every component" stance in §5.
            },
            digest: generateDigest(ref),
          });
          item.members?.forEach(walk);
        };
        walk(pkg);
      }
      logger.info(`loaded ${API_JSON_FILES.length} api-extractor models`);
    },
  };
}
```

Registered in `content.config.ts` alongside the hand-authored `docs` collection:

```ts
import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { apiExtractorLoader } from "../loaders/api-extractor-loader";

const tsApi = defineCollection({
  loader: apiExtractorLoader("./etl/ts"),
  schema: z.looseObject({ kind: z.string(), name: z.string() }),
});

export const collections = { docs, tsApi };
```

The loader's job stops at storing structured, typed entries — an `[...slug].astro`
route renders them, so the reference pages are built from the same `Pure*`
component vocabulary as the rest of the shell rather than a second, bespoke
templating layer. This whole sketch is unverified against real output; `api-extractor`
itself has been run end-to-end (936KB JSON, clean exit), but no page-generator has
been written against its `ApiItem` tree yet.

## 5. Component architecture

The convention already in social-embed is worth keeping intact: `Pure*`-prefixed
components (`PureSiteTitle`, `PureThemeSelect`, `PureSearchButton`) are
presentational and stateless in props — they read `Astro.url` or take explicit
inputs, render markup and scoped `<style>`, and own at most a small vanilla
`<script>` for interaction. `CoreHeaderLayout`'s named slots are the extension
seam: adding a language switcher or version switcher means filling a slot in
`BaseLayout`, not editing the header skeleton. React is reserved for the one place
interactivity genuinely needs component state and re-render logic — the search
modal's result list and keyboard navigation (`usePagefindSearch`). Everything else
that reacts to user input — theme cycling, tab switching, mobile panel toggling,
the search `<dialog>` itself — is a native `customElements.define()` class with a
`<script>` tag, zero framework runtime shipped. That split matters more for
libtmux.org than it did for social-embed, because the version switcher and
dark-mode shim (§4, §7) have to mount inside five foreign generators with no
JavaScript framework of their own; only the vanilla half of this convention is
portable there.

## 6. Tabs/TabItem as the cross-language mechanism

`Tabs`/`TabItem` already solves "the same content, several ways" for package
managers (`npm`/`yarn`/`pnpm`) via its `syncKey` prop — selecting a tab in one
`Tabs` block updates every other block sharing that key, persisted to
`localStorage` under `tabs-sync-${syncKey}` so the choice survives navigation.
For libtmux.org this becomes the primary device for "the same task in eight
languages": a guide page's code sample is one `<Tabs syncKey="lang">` block with
eight `<TabItem>` panels (Python, TypeScript, Rust, Go, .NET, Java/Kotlin, Swift,
C++), and picking a language once carries it across every subsequent code sample
on the site. No component change is needed — the mechanism already generalizes
past two panels; only the content authors filling eight `<TabItem>`s per example
is new work, and it is prose work, not shell work.

## 7. What the shell does not own

Five of the eight ports never touch Astro at all. Rust keeps rustdoc, skinned via
three separate flags with three separate jobs — `--html-in-header` for the token
stylesheet `<link>`, `--html-before-content`/`--html-after-content` for the header
and footer chrome itself, `--extend-css` for color overrides; Java and Kotlin keep
Dokka HTML, skinned via `customStyleSheets`/`templatesDir`; Swift keeps DocC,
skinned via `theme-settings.json` and a `header.html`/`footer.html` pair dropped
into the `.docc` catalog; Python and C++ keep Sphinx + `sphinx-gp-theme`, unchanged.
None of these run through an Astro build, an Astro route, or an Astro content
collection — the shell supplies them a runtime-loaded header, footer, token
stylesheet and version-switcher script (ledger §6: loaded from a stable URL at
runtime, not baked into each build) that each generator's own extension point
injects into HTML the shell never rendered.

Swift is the narrowest floor, not the widest. An earlier proposal scored Swift
3/10 on the claim that swift-docc-render has no HTML injection point at all; the
ledger names that claim wrong (§1, "Why not the alternatives," point 2) and §7.1
verifies the real chain: a plain `header.html`/`footer.html` fragment dropped at
the top of the `.docc` catalog is auto-discovered, wrapped in a `<template>`, and
registered as a custom element by docc-render's own `CustomComponents` plugin —
four steps, all in source, none requiring us to write a `customElements.define()`
call ourselves. That mechanism is gated behind `--experimental-enable-custom-templates`,
an undocumented Apple flag to re-check on every toolchain bump, but the header and
footer with a back-link to libtmux.org are expected to land on Swift pages, same
as everywhere else. What is genuinely open is narrower: whether a `<script>` tag
inside that fragment executes once the template content is cloned into a Shadow
DOM is explicitly unverified — so the version switcher's *interactivity* on Swift
pages, not its presence, is the thing to test before relying on it.
