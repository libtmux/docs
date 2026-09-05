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

The shell renders two of the eight ports' API references directly
(TypeScript and .NET, see below). The other self-hosted ports bring their own
generator's HTML into the same output tree; the shell's header, footer, and
version-switcher markup is injected into that output rather than rendered by
Astro for it. `site/src/layouts/BaseLayout.astro` and
`site/src/components/VersionSwitcher.astro` both carry this split in their
own comments: the switcher is a framework-free custom element
(`<libtmux-version-switcher>`) precisely so the *same* markup can be dropped
into Sphinx, rustdoc-family, Dokka, or DocC output as well as into an Astro
page.

## The three renderers

`site/src/lib/ports.ts` defines a `Renderer` type with three renderers that
actually produce a self-hosted page, plus a `'none'` value for ports that
don't render here at all:

| Renderer | Ports | What feeds it |
|---|---|---|
| `sphinx` | Python, C++ | Python: existing Sphinx + `sphinx-gp-theme` docs, unchanged. C++: Doxygen XML → Breathe → the same Sphinx theme, so no Doxygen-produced HTML is ever published (licensing: running a GPL tool is fine, importing a GPL Sphinx extension is not — see `notes/research/00-DECISIONS.md` §2.6). |
| `astro` | TypeScript, .NET | TypeScript: `@microsoft/api-extractor`'s JSON model, hand-rendered — TypeDoc cannot run against this project's TypeScript 7 toolchain (`00-DECISIONS.md` §2.1), so there is no themable off-the-shelf generator for this language and the pages are built directly against the JSON. .NET: `docfx metadata`'s YAML model, same treatment. |
| `native-skinned` | Swift | Apple's DocC, skinned with our CSS and a `header.html`/`footer.html` fragment pair rather than replaced. |

The remaining three ports — Rust, Go, Java/Kotlin — have `renderer: 'none'`
and `referenceMode: 'ecosystem'`: their reference lives entirely on a
canonical outside host (docs.rs, pkg.go.dev, javadoc.io respectively) and
this repo never builds or hosts a page for them. `PortSwitcher.astro` marks
these with an external-link glyph so a reader knows the click leaves
`libtmux.org` before they take it, rather than discovering it from the
address bar.

`referenceUrl(port, version)` in `ports.ts` is the one function that knows
how to turn a port into a reference URL, self-hosted or ecosystem; nothing
else in the shell should special-case a port slug to decide where its docs
live.

## The version axis

Every build is one Astro invocation targeting exactly one version, driven by
environment variables read in `site/astro.config.ts` and
`site/src/lib/versions.ts`:

- `LIBTMUX_DOCS_VERSION` — the slug: `latest`, `stable`, `v0.46.2`, `v0.x`,
  `pr-123`.
- `LIBTMUX_DOCS_VERSION_KIND` — `trunk | tag | branch | pr | alias`.
- `LIBTMUX_DOCS_IS_DEFAULT` — `'true'` on exactly one build per port: the one
  the default alias (normally `stable`) currently resolves to.
- `LIBTMUX_DOCS_BASE` — the Astro `base`, so the build's own links and
  canonical tag land under the right prefix.
- `LIBTMUX_DOCS_SITE` — the absolute origin, for canonical/sitemap URLs.
- `LIBTMUX_DOCS_DEFAULT_VERSION` — read by `BaseLayout.astro` (defaults to
  `'stable'`) to know which alias this port's pages canonicalise toward; not
  listed in `astro.config.ts`'s own header comment, so look here instead.

`/stable/` and `/latest/` are real, separate builds — not a rewrite of one
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

The one problem a versioned, eight-port site has by construction: most URLs
on it are near-duplicates of another URL on it, and search engines rank
duplicates against each other unless told which one wins.

- **One indexable version per port.** `robotsFor(entry, isDefault)` in
  `versions.ts` returns `noindex, nofollow` for a `pr` build, `noindex,
  follow` for anything marked `eol`, `index, follow` for the default-alias
  build, and `noindex, follow` for every other version. Shell pages that
  don't belong to a port (the landing page, concepts, guides) have no
  version axis at all and are always indexable.
- **Canonical to the default alias.** `canonicalUrl()` points a non-default
  version's page at the same path under `defaultVersion` for that port —
  e.g. a reader on `/py/v0.40.0/guides/panes/` gets a canonical tag pointing
  at `/py/stable/guides/panes/`. A page that exists only in that one version
  (`existsInDefault: false`) canonicalises to itself instead, so a real page
  is never told its canonical URL is a 404.
- **Sitemap only from the default build.** `astro.config.ts` computes
  `wantSitemap = isDefaultBuild && versionKind !== 'pr'` and only registers
  `@astrojs/sitemap` when that's true, with a filter that also drops any
  `/pr-*/` or `/demo` path that slipped through. Every other build — every
  tag, every non-default branch, every PR preview — emits no sitemap at all,
  so crawlers are never handed a list of the duplicates `robotsFor` is
  telling them to skip.
- **`Seo.astro`** is where all of this actually lands in `<head>`: canonical
  link, `robots` meta, `hreflang` alternates (`x-default` pointing at the
  unprefixed English page), Open Graph tags, and a typed `schema-dts`
  JSON-LD graph — `WebSite` on the landing page, `TechArticle` (carrying
  `programmingLanguage` and `about.name`) on every port page.

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

- **Go is not Astro-rendered.** `site/src/content.config.ts`'s header
  comment ("Three ports render their reference through this Astro app... —
  TypeScript, .NET, Go") and `site/src/layouts/BaseLayout.astro`'s header
  comment ("the three ports whose reference we render ourselves") both claim
  a third Astro-rendered port. `ports.ts`'s data says otherwise: Go is
  `referenceMode: 'ecosystem'`, `renderer: 'none'`, pointing at pkg.go.dev.
  Only TypeScript and .NET have `renderer: 'astro'`.
- **`ports.ts`'s own top-of-file policy comment overstates its ecosystem
  list.** It names "docs.rs, pkg.go.dev, javadoc.io, Swift Package Index" as
  the deep-link hosts, but the `PORTS` array gives Swift
  `referenceMode: 'self-hosted'` and `renderer: 'native-skinned'`, with no
  `ecosystemHost` at all. Swift is self-hosted, skinned DocC — the comment's
  fourth host is stale.
- **`notes/research/00-DECISIONS.md` §1 describes a different, larger
  design** than what's built: its recommendation self-hosts all eight ports,
  including Rust (skinned rustdoc), Go (doc2go `-embed`, wrapped by Astro),
  and Java/Kotlin (skinned Dokka) — the "Astro shell + native tier2"
  architecture, scored against a "Thin Shell" fallback that deep-links those
  same three to their ecosystem hosts (§1, "Why not the alternatives").
  `ports.ts` implements the **Thin Shell fallback for exactly those three
  languages** (Rust, Go, Java) while keeping the other five self-hosted —
  a hybrid the research document names as an option (§5) but doesn't itself
  land on. Any note in `notes/research/` describing Rust, Go, or Java as
  self-hosted or Astro/native-skinned is describing the unbuilt
  alternative, not this codebase.
