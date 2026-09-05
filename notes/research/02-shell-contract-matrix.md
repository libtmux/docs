# The shell contract: what each generator lets you change

Across libtmux's eight language ports, only two generators — api-extractor (TypeScript)
and docfx (.NET) — emit a data model our own Astro shell renders end to end. The other
six render their own HTML, so the site's design reaches those pages only through
whatever head/header/footer/CSS injection points each tool exposes. This is the
per-generator, flag-by-flag record of those points, verified against each tool's source.

## The seven capabilities

Every row in the matrix below answers the same seven questions: **base path** (does
output survive a nested URL prefix like `/py/v0.46/`, or does it assume the domain
root?); **head injection** (a supported `<link>`/`<script>` into `<head>` — tokens CSS,
the switcher script); **header/footer HTML injection** (arbitrary HTML above or below
the tool's own content — shared nav, language switcher); **machine-readable output** (a
structured JSON/YAML model a renderer could walk, not just HTML); **native search** (a
shipped client-side index, and whether it collides with site-wide Pagefind); **versioning**
(does the tool understand "more than one build of this," or is that an external
per-prefix loop); and **template override** (can the page skeleton, not just
CSS/head/foot, be replaced, and how brittle across upstream releases).

## The tier taxonomy

Every generator lands in one of three tiers, and the tier — not the language — predicts
how much of libtmux.org's design system a reference page can actually carry:

- **tier1-astro-renders** — the tool's job stops at a structured model (JSON, YAML, or a
  Sphinx doctree already flowing through our own theme); every page is a component we
  own, with no upstream page skeleton to fight.
- **tier2-skin-inject** — the tool renders its own HTML; design control is whatever
  head/CSS/header-footer surface it exposes. This is a ceiling: page-internal layout
  (how a signature block wraps, whether a parameter table collapses) stays the tool's,
  not ours, no matter how much CSS is layered on.
- **tier3-iframe-or-link** — the output cannot be reached at all without owning its host
  (pkg.go.dev, javadoc.io) or forking its source. No generator actually used by
  libtmux.org lands here; it appears only among alternatives each language's research
  rejected (plain `javadoc`, Dokka's plugin-javadoc, pkgsite's live frontend).

Of the eight languages, TypeScript and .NET land in tier1, and C++ reaches tier1 by a
different route: it renders through the *same* Sphinx pipeline already serving Python,
so there is no new template surface to own, only new content flowing into an existing
one. TypeScript is tier1 by necessity — TypeDoc, the only themable HTML generator in its
ecosystem, crashes at module load against the project's TypeScript 7 compiler, with no
recovering flag. .NET is tier1 by choice: `docfx build`'s own HTML stage is a real tier2
option, but `docfx metadata --outputFormat ApiPage` gives a versioned,
cross-reference-resolved model cheap enough that hand-rendering it wins on uniformity.
The remaining five — Python, Go, Rust, Java + Kotlin, Swift — are tier2, skinned through
native injection points and never forked wholesale.

## Comparison table

| Language(s) | Generator | Base path | Head inj. | Header/footer inj. | Machine-readable | Native search | Versioning | Template override | Tier |
|---|---|---|---|---|---|---|---|---|---|
| Python | Sphinx + Furo (gp-sphinx) | Relative (`pathto()`); `html_baseurl` unset | Yes — `html_css_files` | Yes — `!extends` | No — `.fjson` fragments only | Yes, dupes Pagefind | External — sphinx-multiversion | Yes — `_templates/` | tier2-skin-inject |
| C++ | Doxygen XML → Breathe → Sphinx | Inherited | Inherited | Inherited | N/A — Breathe *is* the doctree | Inherited | Inherited | Inherited | tier1-astro-renders¹ |
| TypeScript | api-extractor (JSON only) | N/A, no HTML | N/A | N/A | Yes — `docModel` `*.api.json` | N/A | N/A first-party | N/A, no template | tier1-astro-renders² |
| .NET | `docfx metadata --outputFormat ApiPage` | N/A, no HTML | N/A | N/A | Yes — versioned `Block[]`, refs pre-resolved | N/A | N/A — `groups` fans dirs only | N/A (unused) | tier1-astro-renders³ |
| Go | doc2go `-embed` | Yes, free — `relative.Path()` | No — no `<head>` at all | No — zero chrome | No — zero JSON/XML in source | Disallowed with `-embed` | Yes — `-subdir`, shared assets trap | No — `go:embed`'d, no flag | tier2-skin-inject |
| Rust | rustdoc | Yes, free, stable — `root_path()` | Yes — `--html-in-header` | Yes — `--html-before/after-content` | No on stable — nightly-only | Yes, own index | None — belongs to docs.rs | No — compiled-in Askama | tier2-skin-inject |
| Java + Kotlin | Dokka HTML | Yes, free — `pathToRoot` | Yes — `customStyleSheets`/`Assets` | Yes, whole-file — `templatesDir` (5 `.ftl`) | No — GFM output is Alpha | Yes, conflicts w/ Pagefind | Yes, separate — plugin-versioning | Partial — body is opaque `<@content/>` | tier2-skin-inject |
| Swift | DocC + docc-render | **Absolute** — `{{BASE_PATH}}` bake | No `<head>` flag — `DOCC_HTML_DIR` forks dist | Yes — `header.html`/`footer.html` fragments | Yes — RenderNode + `index.json`, unconditional | No by default — needs `-with-content` flag | None — one build per version | `DOCC_HTML_DIR` full dist fork | tier2-skin-inject |

¹ Via the existing Sphinx pipeline, not a hand-built renderer. ² Forced — TypeDoc is blocked, see below. ³ Chosen over docfx's own tier2 HTML build.

## Python — Sphinx 9.1.1 + Furo, via gp-sphinx's `merge_sphinx_config`

License: BSD-2-Clause (Sphinx), MIT (Furo, gp-sphinx). This is the pipeline already
running production at `libtmux.git-pull.com`; every mechanism below is in active use,
not hypothetical.

- **Base path.** Sphinx's own navigation and asset links go through `pathto()`, which
  calls `relative_uri(baseuri, otheruri)` — path-depth independent
  (`~/study/python/sphinx/sphinx/builders/html/__init__.py:1088-1108`). `html_baseurl`
  only feeds `ctx['pageurl']` (the `<link rel=canonical>` tag) and
  `sphinx.ext.githubpages`' CNAME writer, and it is **not set** today in either
  `~/work/python/libtmux/docs/conf.py` or gp-sphinx's `config.py:590-609`. Before any
  prefix move, four root-absolute hrefs in `docs/_templates/page.html`
  (`/manifest.json`, `/_static/favicon.ico`, two icon paths) plus `docs/manifest.json`'s
  `start_url`/`scope` fields must be templated off `html_baseurl` instead.
- **Head injection.** `html_css_files=["css/custom.css"]` is already set in
  `docs/conf.py`; `html_js_files` is the JS analog, both normalized through
  `convert_html_css_files` (`sphinx/builders/html/__init__.py:1295`).
- **Header/footer injection.** `docs/_templates/page.html` does
  `{% extends "!page.html" %}` and writes into `block extrahead` — the `!` prefix is
  Sphinx's documented "extend the theme's original template" mechanism, already live.
- **Machine-readable output.** `-b json`/`-b text`/`-b xml` builders exist
  (`docs/justfile` has a `json` target) but emit per-page `.fjson` HTML fragments, not a
  clean data model — this alone would rule Sphinx out of tier1, moot since it reaches
  tier1 by inheritance through the C++ row instead.
- **Native search.** Furo ships `searchindex.js`/`searchtools.js`, confirmed by the
  CloudFront invalidation list in `.github/workflows/docs.yml`. Coexists with Pagefind
  technically; hiding Furo's widget on Pagefind-covered pages is an open UI call.
- **Versioning.** None first-party in Sphinx itself. sphinx-multiversion's mechanism —
  fixed `confdir` outside the per-ref loop, content pulled per ref via `git archive`
  (`main.py:196-199,352`; `git.py:196-217`) — gives "old prose, current design system",
  verified against tags v0.20.0 and v0.40.0. It is presently broken against Sphinx 9
  (a `Config.read()` `TypeError`), not yet a blocker since gp-sphinx pins
  `sphinx>=8.1,<9`; the fix, PR #202, sits unmerged upstream and must be vendored before
  that pin is raised.
- **Template override.** `_templates/<name>.html` + `{% extends "!<name>.html" %}` —
  Sphinx's documented mechanism, already used in production by gp-furo-theme.

## C++ — Doxygen `GENERATE_XML=YES` → Breathe → the same Sphinx pipeline

License: GPL-2.0-only (Doxygen, build-time only, never redistributed as HTML),
BSD-3-Clause (Breathe). Every one of the seven capabilities above is inherited wholesale
from the Python row, because Breathe's output is not an intermediate format for a
separate renderer — it *is* the Sphinx doctree, built from ordinary reST directives
(`.. doxygennamespace:: libtmux`) Breathe expands from Doxygen's XML. `GENERATE_HTML=NO`
means Doxygen's own head/header/footer flags (`HTML_HEADER`, `HTML_FOOTER`,
`HTML_EXTRA_STYLESHEET` — `~/study/c++/doxygen/src/config.xml:2063,2196,2230`) are real
but moot for this path.

The real cost is a prerequisite, not a tooling gap: `~/work/libtmux/libtmux-cxx` has zero
Doxygen-tagged comments today (`rg -l '^\s*///|/\*\*' include/` returns nothing) — every
header's `//` prose needs converting to `///`-prefixed comments before Breathe can
capture it, across roughly 26 headers.

## TypeScript — `@microsoft/api-extractor` (JSON model, no HTML generator exists)

License: MIT. This row is forced, not chosen: see the hard blocker below.

- **Machine-readable output** is the entire point. `docModel` emits `*.api.json`
  (`docModel`/`dtsRollup`/`apiReport` keys,
  `apps/api-extractor/src/schemas/api-extractor.schema.json`). Run end to end against
  libtmux-ts's real `packages/libtmux/dist/index.d.ts`: `api-extractor run -c
  api-extractor.json --local` (v7.59.0) completed successfully and emitted a 936,568-byte
  `index.api.json` (`schemaVersion: 1011`) enumerating the real
  `Client`/`Session`/`Window`/`Pane` surface, with warnings only.
- **Base path, head injection, header/footer injection, native search, template
  override** are all N/A: api-extractor produces a `.d.ts` rollup and a JSON model, no
  HTML, no CSS hook, nothing to skin. Astro owns 100% of the page.
- **Versioning** is N/A at the first-party level; `dtsRollup`'s alpha/beta/public
  trimmed outputs are API-*maturity* variants (by `@release` tag), not release-version
  variants — do not conflate the two.
- **Why this row exists at all.** TypeScript 7.0.2 is the Go-native compiler rewrite;
  its `package.json` maps the root import to `lib/version.cjs`, exporting only
  `version`/`versionMajorMinor` — zero matches for `SyntaxKind` anywhere in the package.
  TypeDoc 0.28.20 crashes at ESM module-load time even for `typedoc --version`, tracked
  at TypeStrong/TypeDoc#3098 with no maintainer timeline, and blocks every TypeDoc-built
  path identically (`typedoc-plugin-markdown`, `starlight-typedoc`, `sphinx-js`).
  api-extractor survives because it bundles its own `typescript@5.9.3`
  (`peerDependencies: null`) and parses emitted `.d.ts` rather than compiling source.

## .NET — `docfx metadata --outputFormat ApiPage` (YAML model, HTML stage unused)

License: MIT. docfx offers a real tier2 path too, `docfx build`'s own "modern" HTML
template, but the chosen path skips it entirely.

- **Machine-readable output**, the reason this route wins: `--outputFormat
  {Mref|Markdown|ApiPage}` (`src/docfx/Models/MetadataCommandOptions.cs:20-22`). ApiPage
  is a documented, versioned `Block[]` schema (`docs/docs/api-page.yml`) with
  cross-references already **resolved at generation time** as `{text, url}` objects —
  confirmed against a real fixture: same-project refs get flat
  `Namespace.Type.Member.html` filenames (one regex remap to the site's own route
  slugs), external BCL refs already point at absolute `learn.microsoft.com` URLs.
- **Base path, head/header/footer injection, native search** are N/A for the
  metadata-only path — Astro owns routing and chrome entirely. The unused alternative,
  `docfx build`, has real hooks of its own (footer via `{{{_appFooter}}}`,
  `_master.tmpl:153`; search via `ExtractSearchIndex` → `index.json` → a Lunr worker,
  disable with `_enableSearch: false`) but header/nav needs a full template fork.
- **Versioning.** No first-party runtime switcher in either mode. `groups`
  (`BuildJsonConfig.cs`) only fans one build out to multiple named output directories —
  no "latest" alias, no switcher UI.
- **Template override.** `docfx template export <name>` ejects an embedded template to
  disk; `-t dir1,dir2` layers directories, last-filename-wins, no compatibility contract
  beyond that. Not exercised in the chosen ApiPage path.

## Go — doc2go, `-embed` mode

License: Apache-2.0. Ledger ruling: **use `-embed`, not a template fork.** A fork of
doc2go's templates needs rebasing on every doc2go release — the standing cost this whole
architecture exists to avoid. The fork option is worse than it looks anyway: `-embed`
and `-pagefind` cannot be combined (`flags.go:187-191` hard-errors on both being set), so
Go gives up doc2go-native search either way and falls back to the site-wide Pagefind
crawl regardless of which injection route is taken.

- **Base path.** Free, no flag needed. All internal links route through
  `relative.Path()`/`relative.Filepath()` (`internal/relative/relative.go:25,39`) via
  src/dst common-prefix removal — verified empirically: a `tmux` package linking to
  sibling `tmuxq` rendered `../`-style hrefs, never `/tmux`.
- **Head and header/footer injection.** No in standalone mode — `layout.html:1-14`
  hardcodes the entire `<head>`, and the closest to a footer hook is two Go `{{block}}`s
  (`PkgVersion`, `NavbarExtra`) baked into the `embed.FS`, overridable only by forking
  `internal/html/tmpl`. Both questions are moot in `-embed` mode: `Embedded` templates
  return `"Body"` as their template name (`render.go:104-108`), so zero chrome of any
  kind is emitted — confirmed by a fragment that starts directly at
  `<h2 id="pkg-overview">` with no wrapper at all. The embedding Astro page supplies
  100% of `<head>`, nav, and footer.
- **Machine-readable output.** None — grepped the entire non-test source tree for
  `encoding/json`/`.json` usage, zero hits. `-frontmatter` prepends a user-supplied
  YAML/TOML *text* template for Hugo/Jekyll SSG ingestion; not a head-injection mechanism.
- **Versioning.** First-party via `-subdir NAME`, writing to `OUTDIR/NAME` and
  regenerating a sibling `OUTDIR/index.html` listing every subdirectory present —
  verified by building v0.1.0 then v0.2.0 into the same `-out`. The trap: static assets
  under `OUTDIR/_/` are **shared** across every `-subdir` version, so a doc2go binary
  bump silently restyles every previously published version. Pin the binary in CI, or
  copy each version's own `_/` before deploy.
- **Template override.** None via disk — `internal/html/render.go:29-63` builds all
  five page templates from a `//go:embed tmpl/*.html` filesystem; there is no
  `os.Open`/`DirFS` anywhere in the package, and no `-template` flag exists.

Build command actually run against the real module:

```console
$ doc2go \
    -embed \
    -home github.com/libtmux/libtmux-go \
    -basename index.md \
    -highlight classes: \
    ./tmux/...
```

## Rust — rustdoc

License: MIT OR Apache-2.0. Every injection flag below is **Stable**, confirmed against
both `lib.rs`'s opt registrations and a real `rustc 1.98.0` build — none of this needs
nightly.

- **Base path.** Works on stable, no flag needed: `root_path()` returns
  `"../".repeat(self.current.len())`
  (`~/study/rust/rust/src/librustdoc/html/render/context.rs:212-213`), and
  `get_static_root_path()` defaults off it
  (`src/librustdoc/html/layout.rs:40-45`). `--enable-index-page` is **Unstable**, so
  stable `cargo doc` never writes a root `index.html` — a hand-written redirect at the
  prefix root is required.
- **Head injection.** `--html-in-header <FILE>` (Stable) splices content immediately
  before `</head>`, after rustdoc's own CSS/JS, so an injected `<link>` wins the cascade.
  `--extend-css <FILE>` (an overlay `<link>`, "your theme might break" per its own
  `--help` text) and `--theme <FILE.css>` + `--default-theme <NAME>` (a full alternate
  theme in rustdoc's own picker) are the complementary Stable skin mechanisms; a theme
  missing some of its default custom properties — 128 per a real `cargo doc` build, 105
  per grepping the shipped CSS, **unreconciled, don't quote either** — only warns,
  non-fatally (`config.rs:766-772`).
- **Header/footer injection.** `--html-before-content <FILE>` (right after `<body>`) and
  `--html-after-content <FILE>` (right before `</body>`, after `</main>`) — both Stable.
- **Machine-readable output.** `--output-format=json` is a hard fatal error on stable
  without `-Z unstable-options` + nightly (tracking issue #76578, `config.rs:465-472`).
  The schema (`rustdoc-json-types`, `FORMAT_VERSION: u32 = 61`) is real and docs.rs runs
  it in production continuously, but that is an ecosystem-scale nightly commitment this
  pipeline does not take on.
- **Native search.** rustdoc ships its own per-crate index
  (`html/render/search_index.rs`); doesn't conflict with Pagefind, but the two remain
  separate widgets on the same page.
- **Versioning.** None first-party — rustdoc only ever emits the one crate/version it
  was invoked on. All multi-version UX belongs to docs.rs.
- **Template override.** Not available — no `--template` flag in `lib.rs` or
  `config.rs`. The 10 page templates are Askama, compiled into the binary
  (`askama.toml: dirs = ["html/templates"]`); reaching them means forking and rebuilding
  the `rust-lang/rust` toolchain itself.

## Java + Kotlin — Dokka HTML (plugin-base's default renderer)

License: Apache-2.0. One Gradle plugin, `org.jetbrains.dokka:dokka-gradle-plugin`,
covers both languages from a single pass.

- **Base path.** Free, implicit — every resource and page href is emitted relative to a
  computed `pathToRoot`, never root-absolute
  (`DefaultTemplateModelFactory.kt:126,132,140`). No dedicated flag exists because none
  is needed.
- **Head injection.** `DokkaBaseConfiguration.customStyleSheets`/`customAssets`
  (`List<File>`) — `CustomResourceInstaller` copies them under `styles/`/`images/`, and
  `base.ftl`'s `<@resources/>` macro renders them as real `<link>`/`<script>` tags. A
  `.js` file becomes a `<script>` tag, so version-switcher JS rides in via `customAssets`.
- **Header/footer injection.** Whole-file only, via `templatesDir`
  (`DokkaBaseConfiguration.templatesDir: File?`) — FreeMarker's `MultiTemplateLoader`
  tries `templatesDir` first, falls back to the classpath copy (`HtmlTemplater.kt:45-54`).
  Exactly 5 overridable `.ftl` files exist (`base`, `header`, `footer`, `page_metadata`,
  `source_set_selector`) — no additive rustdoc-style before/after-content flag.
- **Machine-readable output.** None usable from the HTML renderer. A separate plugin-gfm
  CommonMark output exists but is self-reported **Alpha** (`GfmPlugin.kt:49-58`) and
  drops every one of `CustomResourceInstaller`/`SearchbarDataInstaller`/`StylesInstaller`
  — none of the styling or nav data a custom renderer would want is carried into it.
- **Native search.** `SearchbarDataInstaller.kt:27-102` writes a static
  `scripts/pages.json` consumed by a bundled widget wired into `header.ftl`'s
  `#searchBar` div — no flag disables generation; hide it with injected CSS to leave
  Pagefind as the sole search UI.
- **Versioning.** First-party but a separate mechanism from an S3-path scheme:
  `plugin-versioning`'s `VersioningConfiguration` (`olderVersionsDir`, `olderVersions`,
  `version`) requires a pre-populated directory of every prior version's **full** HTML
  build. Do not adopt it — fold Java/Kotlin versioning into the same per-prefix build
  loop as the other seven languages.
- **Template override.** Working but partial: the 5 `.ftl` files above are replaceable,
  but page body content (`base.ftl`'s `<@content/>` slot) is one opaque region filled by
  Dokka's own Kotlin `HtmlRenderer` — class/member markup is never template-driven.

## Swift — DocC + swift-docc-render, via swift-docc-plugin

License: Apache-2.0 across all three repositories. The injection story here needs its
full chain of custody, because an earlier draft in this document set got it wrong.

- **Base path — the one true absolute-path generator.** `--hosting-base-path <path>`
  (`Convert.swift:159`) triggers `StaticHostableTransformer.indexHTMLData()`, a literal
  string replace of the token `{{BASE_PATH}}` inside `index-template.html`
  (`StaticHostableTransformer.swift:14-18,96-134`); docc-render's `vue.config.js` sets
  `publicPath` to that same placeholder at build time. Each version needs its own
  `--hosting-base-path swift/vX.Y.Z/api` invocation — the compiled bundle cannot be
  shared across two prefixes the way rustdoc's or Sphinx's output can.
- **Header/footer injection — plain fragments, no manual wiring required.** Ledger-
  corrected: a plain HTML fragment is sufficient, and nothing in it needs to call
  `customElements.define()` itself. The chain, read from source: (1) you write
  `header.html` as a plain fragment at the top level of the `.docc` catalog — filenames
  are fixed (`DocumentationCatalogFileTypes.swift:64,72`), discovery is automatic
  (`DocumentationInputsProvider.swift:163-166`), no path flag exists; (2) `docc convert`
  wraps it for you — `ConvertFileWritingConsumer.swift:243` builds
  `<template id="custom-header">` + your file's contents + `</template>` and splices it
  in right after the opening `<body>` tag; (3) docc-render registers it for you — its
  bundled `CustomComponents` Vue plugin, installed unconditionally at
  `SwiftDocCRenderPlugin.js:26`, looks up `document.getElementById('custom-header')` and
  calls `window.customElements.define()` at `CustomComponents.js:47`; (4) `App.vue:23,30`
  then renders `<custom-header v-if="hasCustomHeader">`, where `hasCustomHeader` is
  `!!window.customElements.get('custom-header')` (`App.vue:97`).

  Gated behind `--experimental-enable-custom-templates` — Apple's own flag name,
  undocumented in either repository's README — so treat it as unstable across toolchain
  releases and re-check on every bump. Whether a `<script>` inside the fragment executes
  after being cloned into shadow DOM is unverified — test before relying on it for the
  version-switcher mount.
- **Head injection.** No native flag for arbitrary `<head>` content — both custom
  templates land in `<body>`, never `<head>` (`FileWritingHTMLContentConsumer.swift:42-45`).
  `theme-settings.json` gives roughly 198 `--color-*` properties, but that is CSS
  variables, not a stylesheet-link point. The real escape hatch is `DOCC_HTML_DIR`
  (`TemplateOption.swift:24`), swapping docc's entire template directory — a fork of
  swift-docc-render's compiled dist, re-diffed against an upstream that commits weekly.
- **Machine-readable output.** Yes — RenderNode JSON per page plus a site-tree
  `index/index.json`, written **unconditionally**: `ConvertAction.swift:429-432`'s own
  comment states "Always emit a JSON representation of the index"; `--disable-indexing`
  only drops the LMDB binary index used by Xcode's doc viewer, never the JSON tree. A
  from-scratch renderer could use this to reach tier1, at the separate cost of
  reimplementing docc-render's `doc://` link resolution.
- **Native search.** None by default — stock `--transform-for-static-hosting` writes
  the *same* `indexHTMLData` bytes to every path, an empty Vue shell with no page text, a
  Pagefind dead zone. `--experimental-transform-for-static-hosting-with-content` (a real,
  non-hidden flag) embeds each page's rendered content inside a `<noscript>` block plus a
  real `<title>`/`<meta name="description">`, giving Pagefind genuine text while
  JS-enabled visitors still get the interactive app.
- **Versioning.** None — `rg -ni "version.*switcher|multi.?version|versioning"` returns
  zero hits across swift-docc and swift-docc-render. Built entirely at the CI/CDN layer,
  one `--hosting-base-path` build per version, same as Rust and Go.
- **Template override.** `DOCC_HTML_DIR` — confirmed to survive into the `docc`
  subprocess via `Process.run`'s default environment inheritance
  (`SwiftDocCConvert.swift:140`, no `.environment` override anywhere in the plugin).

## Two verified surprises

**Six of the seven HTML-rendering generators compute page-depth-relative links; one does
not.** rustdoc (`root_path()`), Sphinx (`pathto()`/`relative_uri()`), TypeDoc
(`router.baseRelativeUrl()` — verified even though TypeDoc itself is blocked for
libtmux-ts, see the TypeScript row), Dokka (`pathToRoot`), DocFX (`_rel`) and doc2go
(`relative.Path()`) all treat the output tree as relocatable to any nested prefix with
zero rebuild. **DocC alone bakes an absolute path**, via the `{{BASE_PATH}}` substitution
described above: every other generator's output can, in principle, serve identical bytes
at both `/py/v0.46.2/` and `/py/stable/`; DocC's cannot, and needs a separate build per
alias.

Relative-link universality does *not* settle whether `/stable/` and `/latest/` can be
aliases of one immutable build — that axis is canonical tags and sitemaps, covered in
the versioning document, not here.

**The second surprise: "head injection" and "header/footer injection" are two different
capabilities with two different ceilings**, not one generic "custom HTML" feature.
rustdoc, Doxygen and .NET's `docfx build` all expose real, additive head/footer hooks
(`--html-in-header`, `HTML_HEADER`/`HTML_FOOTER`, `{{{_appFooter}}}`) that splice content
in without touching anything else. Dokka and DocC both refuse an additive head hook,
offering only whole-file template replacement (`templatesDir`, `DOCC_HTML_DIR`) — reached
only because no smaller mechanism exists. doc2go skips the question in `-embed` mode by
emitting no chrome at all — a third, simpler answer than either.
