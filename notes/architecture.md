# Architecture

This describes what `site/src/lib/ports.ts` and `site/src/lib/versions.ts`
actually implement today, not the fuller research proposal in
`notes/research/`. Where the two disagree, this file follows the code — see
"Where the tree disagrees with itself" at the end.

## The shell

One hand-owned Astro 7 site (`site/`) owns everything a reader sees: the
landing page, cross-language concepts, guides, examples, the parity
narrative, and the header/footer/switcher chrome. No documentation framework
— no Starlight, no Docusaurus. Astro is used purely as a build tool and a
component model; every layout and component under `site/src/` is ours to
change.

The shell renders a unified API reference at `/<port>/<version>/reference/`
for all 23 language entries in `PORTS` (19 core ports and 4 JVM and .NET
companion libraries) from extracted models in `site/src/lib/api-models.ts`.
Ports with native HTML builds (`sphinx` or `native-skinned`) can also bring
their own generator's output into the assembled tree, where the shell's
header, footer, and `<libtmux-version-switcher>` custom element are injected
or normalized so native pages share the same navigation chrome as Astro
pages.

## The three renderers

`site/src/lib/ports.ts` defines
`Renderer = 'sphinx' | 'astro' | 'native-skinned'`. Every port declares one
renderer; there is no `'none'` value or off-site-only mode:

| Renderer | Ports | What feeds it |
|---|---|---|
| `sphinx` | Python, C++ | Python: upstream Sphinx + `sphinx-gp-theme` docs. C++: Doxygen XML -> Breathe -> the same Sphinx theme, so no Doxygen-produced HTML is published (running a GPL tool is fine, importing a GPL Sphinx extension is not; see `notes/research/00-DECISIONS.md` §2.6). Both ports also ship extracted API models at `/<port>/<version>/reference/`. |
| `astro` | Ruby, Lua, PowerShell, Julia, Erlang, Elixir, Haskell, Common Lisp, TypeScript, Rust, Go, Java, C#, OCaml, Perl, Raku, plus Clojure, Kotlin, Scala, and F# | Language-specific compiler, doc-chunk, AST, or metadata artifacts normalized by `packages/api-model/` into `site/src/data/api/<port>.json` and rendered directly by Astro at `/<port>/<version>/reference/`. |
| `native-skinned` | Swift | Apple's DocC (`swift-docc-plugin`), skinned with the site's CSS and shell fragments, alongside Swift's SymbolGraph model at `/swift/<version>/reference/`. |

Ports whose ecosystems also run a canonical external API host set optional
`ecosystemHost` metadata in `ports.ts` (`ECOSYSTEM_PORTS`): `docs.rs` for
Rust, `pkg.go.dev` for Go, `javadoc.io` for Java, `Dokka` and `Scaladoc` on
`javadoc.io` for Kotlin and Scala, `HexDocs` for Elixir, and `MetaCPAN POD`
for Perl (`port-inventory.ts` also links `Swift Package Index` DocC targets
for Swift). Those external links appear alongside each port's `libtmux.org`
reference in sidebars, headers, and reference cards, marked as leaving the
site rather than replacing the self-hosted reference.

`referenceUrl(port, version, product)` in `ports.ts` is the one function that
resolves a port's reference URL (`/<port>/<version>/reference/` for `core`,
or `/<port>/<version>/<product>/reference/` for `workspace` and `mcp`);
nothing else in the shell should special-case a port slug to decide where its
reference lives.

`<port>/<version>/api/` is the older path, and it answers differently by port.
Each assembly writes a `noindex` redirect there to the reference this site
renders, and the publisher uploads it — except under a port that declares
`publishesOwnApi`, whose own pipeline publishes that tree. Python is the only
one today: `/py/<version>/api/` is gp-sphinx rendering upstream's own
documentation, the oracle `site/scripts/check-style-parity.mjs` measures this
site against. `scripts/publication-metadata.mjs` drops that tree before the
artifact is declared, and `scripts/publish-root.sh` refuses the path for such a
port however the artifact declares it. Deleting it for every port, which is
what the publisher used to do, left every other port answering 403.

## The version axis

Every build is one Astro invocation targeting exactly one version, driven by
environment variables read in `site/astro.config.ts` and
`site/src/lib/versions.ts`:

- `LIBTMUX_DOCS_VERSION` — the slug: `latest`, `next`, `v0.46.2`, `v0.x`,
  `pr-123`.
- `LIBTMUX_DOCS_VERSION_KIND` — `trunk | tag | branch | pr | alias`.
- `LIBTMUX_DOCS_IS_DEFAULT` — `'true'` on exactly one build per port: the one
  the port's default version names: its newest final release tag, or `latest`
  while it has none.
- `LIBTMUX_DOCS_BASE` — the Astro `base`, so the build's own links and
  canonical tag land under the right prefix.
- `LIBTMUX_DOCS_SITE` — the absolute origin, for canonical/sitemap URLs.
- `LIBTMUX_DOCS_DEFAULT_VERSION` — read by `BaseLayout.astro` (defaults to
  `'latest'`) to know which version this port's pages canonicalise toward; not
  listed in `astro.config.ts`'s own header comment, so look here instead.

`/next/` and `/latest/` are real, separate builds — not a rewrite of one
build served at two prefixes. `sortVersions()` orders the switcher: aliases
first, then trunk, then tags, then branches, newest first within each kind.

Versions are tracked in **one** manifest, not one per port:
`versions.json` at the site root, matching the `VersionManifest` shape —
`{ schema: 1, ports: Record<portSlug, VersionEntry[]>, defaultVersion:
Record<portSlug, string> }`. `VersionSwitcher.astro`'s
`<libtmux-version-switcher>` element fetches it client-side and replaces its
one baked-in `<option>` with the live list, so a version published after a
given build still shows up in that build's own switcher without a rebuild.

## The SEO model

The one problem a versioned multi-port site has by construction: most URLs
on it are near-duplicates of another URL on it, and search engines rank
duplicates against each other unless told which one wins.

- **One indexable version per port.** `robotsFor(entry, isDefault)` in
  `versions.ts` returns `noindex, nofollow` for a `pr` build, `noindex,
  follow` for anything marked `eol`, `index, follow` for the default-version
  build, and `noindex, follow` for every other version. Shell pages that
  don't belong to a port (the landing page, concepts, guides) have no
  version axis at all and are always indexable.
- **Canonical to the default version.** `canonicalUrl()` points a non-default
  version's page at the same path under `defaultVersion` for that port —
  e.g. a reader on `/py/v0.40.0/guides/panes/` gets a canonical tag pointing
  at `/py/v0.46.2/guides/panes/`. A page that exists only in that one version
  (`existsInDefault: false`) canonicalises to itself instead, so a real page
  is never told its canonical URL is a 404.
- **Sitemaps follow the page's own head.** Only the default version's
  build lists pages, and each page's head decides whether it is listed:
  `noindex`, a meta refresh and a canonical elsewhere keep a page out
  (`site/src/lib/sitemap-heads.ts`). The shell's `@astrojs/sitemap`
  filters by URL and asks that verdict through a build hook that runs
  before it. The shell renders only some of a port's pages and the port's
  publisher owns the rest of its tree, so `scripts/gen-port-sitemap.mjs`
  writes `sitemap-0.xml` into each default port tree from the finished
  files, native pages included, and the English index names it
  (`customSitemaps`). Every other build, every PR preview and every
  non-default version lists nothing.
- **Titles.** `documentationTitle` in `site/src/lib/branding.ts` is the one
  scheme, for Astro pages and the native branding pass alike: the page's
  own name, then language, product and kind (`capabilities | TypeScript
  MCP resource | libtmux.org`), then the site name. A title that passes
  `TITLE_BUDGET` gives up the site name first and then the word
  "reference" in "API reference"; the page's name and its language are
  never cut. A language home keeps the title `portHomeTitle` sets. `og:title` and `twitter:title` are
  the same without the site name, and `og:site_name` is `libtmux.org` on
  every page.
- **`Seo.astro`** is where all of this actually lands in `<head>`: canonical
  link, `robots` meta, `hreflang` alternates (`x-default` pointing at the
  unprefixed English page), Open Graph tags, and a typed `schema-dts`
  JSON-LD graph — `WebSite` on the landing page, `TechArticle` (carrying
  `programmingLanguage` and `about.name`) on every port page.

## The machine-readable surface

Every page ends with its source path and links to five things: its own
Markdown, that source on GitHub, `docs.json`, `llms.txt` and `llms-full.txt`.
The Markdown is also advertised in the head as
`<link rel="alternate" type="text/markdown">`, and placed the way gp-sphinx
places it, `docname + ".md"`, so `/topics/panes/` pairs with
`/topics/panes.md` and an index page with `index.md` inside its own
directory. `site/src/lib/markdown-twins.ts` owns that one rule; the footer,
the head link, `docs.json` and every writer read it from there.

Where the text comes from depends on the page. Prose pages and API
declarations have a source, so their Markdown is generated from it — the same
resolved text `llms-full.txt` carries, which is why a section of that file and
a page's Markdown are one text rather than two. Pages assembled from
components and data have no source, so `site/src/integrations/markdown-twins.ts`
converts their rendered HTML after the build. A page that declares a source
twin and does not get one fails the build, which is the gap behind
`notes/upstream/sphinx-gp-llms-md-twins.md`.

A translation build describes what that locale serves: a translated page is
listed and written in its own language, while a placeholder renders the
default locale's text and links its Markdown rather than duplicating the file.

## Search

`site/src/integrations/pagefind.ts` runs the Pagefind CLI once per build,
over that build's own output directory, on Astro's `astro:build:done` hook.
Because Pagefind indexes rendered HTML rather than any one generator's
internal model, one index covers the Astro-rendered pages, the Sphinx
output, and the skinned native-generator output that all land in the same
build's `dist/` — it does not care which of the three renderers produced a
given page. `LIBTMUX_DOCS_SKIP_PAGEFIND=true` skips the pass entirely, which
is what CI-adjacent quick builds (and this repo's own build check) use, since
a single-page or near-empty tree isn't worth indexing.

This is deliberately the whole mechanism today: one index per build, no
cross-build merge. `notes/research/08-search.md` sketches a further step —
merging every port's separately-built index client-side with Pagefind's own
`mergeIndex`/`mergeFilter` APIs, so a search from any one port's pages can
surface results from the others — but that is not implemented. Treat it as a
proposal, not a description of what `pagefind.ts` does.

## Where the tree disagrees with itself

A few places in the already-committed code and its accompanying prose
disagree with `ports.ts`'s actual `PORTS` array, which is the one place this
matters — everything above follows the array, not the prose. Filed here
rather than silently fixed, since fixing these files is not this note's job:

- **Stale three-port comments in `content.config.ts` and `BaseLayout.astro`.**
  `site/src/content.config.ts`'s header comment ("Three ports render their
  reference through this Astro app from a generated model (TypeScript, .NET,
  Go)") and `site/src/layouts/BaseLayout.astro`'s header comment ("the three
  ports whose reference we render ourselves") still describe an earlier
  three-port split. `ports.ts` now sets `renderer: 'astro'` on 20 of the 23
  entries in `PORTS`, and `site/src/pages/reference/[...slug].astro` renders
  extracted `API_MODELS` through `BaseLayout.astro` for every port; the `api`
  collection in `content.config.ts` serves only the legacy
  `/<port>/<version>/api/` route, which redirects to `/reference/` everywhere
  except `publishesOwnApi` (`py`).
- **`ports.ts`'s top-of-file `Renderer` comment omits Perl's `ecosystemHost`.**
  The doc comment above `Renderer` names `(docs.rs, pkg.go.dev, javadoc.io,
  HexDocs, Dokka, Scaladoc)` as `ecosystemHost` examples, leaving out Perl's
  `MetaCPAN POD` entry in `CORE_PORTS` (`ECOSYSTEM_PORTS` has seven ports:
  `elixir`, `rs`, `go`, `java`, `perl`, `kotlin`, and `scala`). Swift's
  external `Swift Package Index` DocC targets are recorded in
  `port-inventory.ts` rather than `ecosystemHost`.
- **`notes/research/00-DECISIONS.md` §1 predates the unified `api-model`
  expansion.** Its September 2026 recommendation covers eight ports, sending
  only TypeScript, .NET, and Go through Astro while keeping skinned `rustdoc`
  and Dokka HTML for Rust and Java/Kotlin (scored against a "Thin Shell"
  fallback that delegated Rust, Go, and Java to `docs.rs`, `pkg.go.dev`, and
  `javadoc.io`). `ports.ts` instead grew to 19 core ports and 4 JVM and .NET
  companion libraries and converged on `packages/api-model/` plus
  `renderer: 'astro'` across 20 of the 23 ports, keeping `sphinx` for Python
  and C++, `native-skinned` DocC for Swift, and `ecosystemHost` as an external
  companion link beside the self-hosted reference.
