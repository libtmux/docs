# Swift reference pipeline

libtmux.org builds Swift API reference with DocC, invoked through `swift-docc-plugin`'s
`generate-documentation` — already a build-time dependency of `libtmux-swift`, pinned
`from: "1.4.3"` — reskinned with `header.html`/`footer.html` catalog fragments and
`theme-settings.json`, synced under `/swift/`. An earlier claim that this needs SPA-style
CDN route rewriting is refuted by source: `StaticHostableTransformer.transform()`
(`StaticHostableTransformer.swift:59-77`) walks every `data/**/*.json` file in the
archive and `createFile`s a real `index.html` into a matching directory for each one —
confirmed against this repo's own build, where `documentation/libtmux/` alone holds 877
such files. The only "serve `index.html` for any URL" handler in swift-docc's codebase
lives in `docc preview`'s dev server (`DefaultRequestHandler.swift:19-21`), compiled in
only under the `PREVIEW_SERVER` trait (`Package.swift:51`) — architecturally excluded
from `docc convert`'s production output. Two constraints are real instead: DocC bakes an
absolute base path into every route's `index.html`, so output cannot be shared across
two URL prefixes; and design control beyond `theme-settings.json` tops out at a
plain-fragment header/footer whose script behavior is unverified.

## The ecosystem convention, and what libtmux.org adds

Swift developers check API docs in three places, in this order of habit:
`developer.apple.com/documentation`, itself built with DocC — so DocC/docc-render's
visual language (large intro banner, right-rail on-this-page nav, "Steps" tutorial UI)
*is* the ambient convention, whether or not a project uses it; Swift Package Index
(`swiftpackageindex.com`), an Apple property since 2026-06-23 that auto-hosts versioned
DocC docs for any package with a `.spi.yml` file in its repo root; and GitHub Pages via
`swift-docc-plugin`'s own documented workflow.

Shipping a `.spi.yml` costs nothing and puts `libtmux-swift` on a surface Swift
developers already check — treat `libtmux.org/swift` as additive, not a replacement. SPI
runs its own `generate-documentation`, so the palette in `theme-settings.json` likely
reaches it too — that file is auto-discovered with no flag
(`DocumentationInputsProvider.swift:163-166`). The header/footer fragments most likely do
not: they need `--experimental-enable-custom-templates`, and whether SPI's own invocation
passes it is unverified. Don't treat SPI as a full preview of the branded build either
way.

What libtmux.org's own `/swift/` build adds on top: the same header, footer, dark-mode
toggle and version switcher every other language port carries, loaded at runtime rather
than baked in (ledger §6), so a shell fix reaches already-published versions without a
DocC rebuild; a `/swift/vX.Y.Z/`, `/swift/stable/`, `/swift/latest/` prefix taxonomy
matching the other seven ports, rather than SPI's own per-package listing; and real
per-page text for the site-wide search box — a naive DocC build, SPI's included, is a
Pagefind dead zone without the `-with-content` flag below.

## Tool decision: alternatives considered and rejected

**jazzy — considered, not chosen.** MIT, with a one-flag `<head>` hook (`--head HTML`,
`config.rb:455-458`) DocC lacks entirely. Rejected anyway: maintenance mode, and its own
README says DocC's symbolgraph transition is "not compatible with Jazzy's symbolgraph
mode" — Jazzy is the pre-DocC tool. Fine as a fallback or for Objective-C `.docset`
output.

**`--output-format experimental-html-for-development` — watched, not viable.** DocC's own
team building a no-Vue, server-rendered output that would reach tier1 for free. Reachable
only via a `help: .hidden` flag whose comment says "not suitable for general use... plan
is to rename..." (`Convert.swift:632-636`); it landed in swift-docc's history on
2026-09-02, the same day as this research, with an open sidebar `FIXME` and no favicon
support. Track it; do not build the launch on it.

**swift-unidoc (Swiftinit) — cited as proof, not adopted.** Parses raw symbolgraphs with
its own compiler, bypassing `docc-render` entirely — production evidence that "skip the
Vue renderer, write your own over DocC's machine output" works at scale. Not a candidate:
MPL-2.0 is weak copyleft, failing the permissive bar Apache-2.0/MIT clear, and it means
adopting a wholly separate compiler, not reusing swift-docc's pipeline.

**A from-scratch Astro renderer over RenderNode/RenderIndex JSON — real, deferred.** Both
are emitted unconditionally (below), versioned and OpenAPI-documented — a genuine path to
tier1. Deferred because it means reimplementing `docc-render`'s `doc://` link resolution
and its declaration/parameter renderers from scratch.

**Result:** DocC + `swift-docc-render`, tier2 skin-inject, via `swift-docc-plugin`.

## The verified shell contract

Every claim below is checked against `~/study/swift/swift-docc{,-render,-plugin}` source
and against a real archive this pipeline already produces:
`~/work/libtmux/libtmux-swift/.build/plugins/Swift-DocC/outputs/LibTmux.doccarchive`.

| Contract point | Mechanism | What it does |
|---|---|---|
| Base path | `--hosting-base-path <path>` | **Absolute, one-shot.** Literal string substitution of the token `{{BASE_PATH}}` inside `index-template.html` (`StaticHostableTransformer.swift:14-18,96-134`). Not shareable across two prefixes. |
| Head injection | none | Both custom templates land in `<body>`, never `<head>` (`FileWritingHTMLContentConsumer.swift:42-45`). The only escape hatch is a full template-directory fork (`DOCC_HTML_DIR`, below). |
| Header/footer injection | `header.html` / `footer.html` in the `.docc` catalog | Plain fragment, auto-wrapped by `docc convert` into `<template id="custom-header">`; `docc-render` registers and mounts it. Gated behind `--experimental-enable-custom-templates`. |
| Machine-readable output | RenderNode JSON per page + `index/index.json` | Written **unconditionally** — `ConvertAction.swift:429-432`'s own comment: "Always emit a JSON representation of the index." |
| Native search | none by default | `--experimental-transform-for-static-hosting-with-content` embeds real per-page text for Pagefind to crawl. |
| Template override | `DOCC_HTML_DIR` env var | Swaps `docc-render`'s entire compiled dist. Survives into the `docc` subprocess via default environment inheritance. |
| Versioning | none | `rg -ni "version.*switcher\|multi.?version\|versioning"` returns zero hits across both repos. |
| Canonical tag | none | Zero matches for "canonical" in either repo's rendering source, and no head-injection flag to add one via a fragment either. |

**Base path, in full.** `--hosting-base-path` (`Convert.swift:159`) triggers
`StaticHostableTransformer.indexHTMLData()`, called only when a custom path is given —
otherwise the archive ships `docc-render`'s own already-resolved `index.html` unchanged
(`StaticHostableTransformer.swift:100-109`). `docc-render`'s `vue.config.js` sets
`publicPath` to the placeholder string `{{BASE_PATH}}` at its own build time
(`bin/baseUrlPlaceholder.js`), preserved in a side-copy, `index-template.html`, which
`docc convert` re-substitutes with the real deployed path when `--hosting-base-path` is
set. Confirmed against this repo's own `LibTmux.doccarchive` (built with no
`--hosting-base-path`): every route's `index.html`, including nested ones like
`documentation/libtmux/tmuxservers/index.html`, resolves every asset URL to the default
`/` (`<script defer src="/js/chunk-vendors....js">`, an inline
`<script>var baseUrl = "/"</script>`) — but `js/index.*.js` still carries the raw,
unsubstituted literal `BASE_URL:"{{BASE_PATH}}/"`, because `transform()` only ever
writes `.html` files, never `.js`. Each version, and each of `/swift/stable/` and
`/swift/latest/`, therefore needs its own full re-run with a different
`--hosting-base-path` value for the HTML that actually carries it. Ledger §2.3 already
mandates separate builds for those two aliases across all eight languages, so this costs
nothing extra — it just removes an option the other seven generators' relative-link
output would otherwise have allowed.

**Header/footer, the corrected chain.** You write `header.html` as a plain fragment at
the top level of the `.docc` catalog — filenames are fixed
(`DocumentationCatalogFileTypes.swift:64,72`), discovery is automatic
(`DocumentationInputsProvider.swift:163-166`), no path flag exists. `docc convert` wraps
it for you: `ConvertFileWritingConsumer.swift:243` builds
`<template id="custom-header">` + your file's contents + `</template>` and splices it in
right after the opening `<body>` tag (the exact line:
`let template = "<template id=\"\(id.rawValue)\">\(templateContents)</template>"`).
`docc-render` registers it for you: its `CustomComponents` Vue plugin, installed
unconditionally at
`SwiftDocCRenderPlugin.js:26`, looks up `document.getElementById('custom-header')` and
calls `window.customElements.define(id, ...)` at `CustomComponents.js:47`. `App.vue:23,30`
then renders `<custom-header v-if="hasCustomHeader">`, where `hasCustomHeader` is
`!!window.customElements.get('custom-header')` (`App.vue:97-98`). **Your fragment never
needs to call `customElements.define()` itself** — a claim to the contrary in the raw
research JSON is stale; see contradictions below.

One nuance the chain above doesn't remove: `CustomComponents.js` mounts your fragment via
`attachShadow({ mode: 'open' })` and `template.content.cloneNode(true)`. A
`<link rel="stylesheet">` inside `header.html` therefore styles only that shadow tree,
never the surrounding page — the shared token palette has to reach a DocC page through
`theme-settings.json` instead. And whether a `<script>` tag inside the fragment
**executes** after being cloned this way is **unverified**: script elements inserted via
`cloneNode` rather than parsed do not auto-execute per the DOM spec, and nothing here
confirms `docc-render` works around that. `04-versioning.md` already flags this as the
highest-risk injection point for the shared version-switcher's mount script — test it
against a real build before relying on it. The whole mechanism is gated behind
`--experimental-enable-custom-templates`, Apple's own flag name, undocumented in either
README — treat it as unstable and re-check on every toolchain bump.

**`theme-settings.json`'s key set**, from `ThemeSettings.spec.json` (schema v0.3.0):
`meta.title`; `theme.color` (198 keys, each a CSS string or `{light, dark}` pair);
`theme.icons` (43 SVG-swap keys, no logo key); `theme.typography` (exactly 2 keys,
`html-font`/`html-font-mono`, no size/weight scale); a top-level `theme.border-radius`
string; per-element border/style objects on
`theme.{aside,badge,button,code,inline-code,tutorial-step}`; a `theme.device-frames`
object for custom tutorial bezels; and
`features.docs.{quickNavigation,onThisPageNavigator,i18n}` flags. Colors, borders, icons,
two font-families and feature toggles — never a logo, a type scale, or new layout.

**Machine-readable output.** `--disable-indexing` is a `swift-docc-plugin` flag, not a
`docc` one: without it, the plugin silently *adds* `--emit-lmdb-index`
(`ParsedArguments.swift:104-106`) — a binary index for Xcode's local doc viewer only.
Passing it suppresses that add; it does **not** remove `index/index.json`, which
`ConvertAction.swift:429-432` writes unconditionally either way.

## The build command

```console
$ swift package \
    --allow-writing-to-directory .build/swift-docc-site \
    generate-documentation \
    --target LibTmux \
    --disable-indexing \
    --experimental-transform-for-static-hosting-with-content \
    --experimental-enable-custom-templates \
    --hosting-base-path swift/v${VERSION}/api \
    --output-path .build/swift-docc-site
```

`--transform-for-static-hosting` is not passed explicitly: it defaults to `true`
(`Convert.swift:168`), and `-with-content` implies it regardless.
`--allow-writing-to-directory` and `--output-path` are plugin-level flags
(`ParsedArguments.swift:179`); everything else is forwarded straight through to `docc`
(`ParsedArguments.swift:96-131` is a full pass-through, not an allowlist).

Prerequisite, one-time: `Sources/LibTmux/LibTmux.docc/` today holds only 7 Markdown
articles (confirmed by listing the catalog directly) — add `header.html`, `footer.html`
and `theme-settings.json` before this command differs visually from stock DocC. For
`/swift/stable/` and `/swift/latest/`, run this again with
`--hosting-base-path swift/stable/api` or `swift/latest/api` — a full separate build,
not a copy.

## Where the output lands, and the CI step

Output lands at `.build/swift-docc-site/documentation/libtmux/**/index.html` (module name
lowercased — confirmed against the real archive), plus `data/`, `index/index.json`,
`css/`, `js/`, `img/`, `favicon.ico`, `favicon.svg` and `theme-settings.json` at the
archive root. Sync it under the version prefix, scoped to that prefix alone per the
standing rule against bucket-root `--delete` (ledger §6):

```console
$ aws s3 sync .build/swift-docc-site/ \
    s3://libtmux-docs/swift/v1.2.0/api/ \
    --delete
```

DocC writes no landing page distinct from any other route at the archive root for a
single target — the root `index.html` is the same generic shell as every other URL. Add
a small redirect (an S3 `x-amz-website-redirect-location` object, or a CloudFront
Function rule) sending `swift/v1.2.0/api/` to
`swift/v1.2.0/api/documentation/libtmux/`.

This runs in `libtmux-swift`'s own CI, on trunk and tag push, per per-repo prefix
ownership (ledger §6). `swift-docc-plugin` needs no new dependency work — already pinned
`from: "1.4.3"`, marked build-time-only ("renders the DocC catalogue in CI, not linked
into anything that ships"). No macOS runner is needed either: this machine's existing
`libtmux-swift` build already produced `.build/x86_64-unknown-linux-gnu/...`, so a
standard Linux runner with the Swift toolchain suffices. The job needs
`concurrency: {group: docs-swift, queue: max}` (§7.6, cannot combine with
`cancel-in-progress`), its own exclusive `manifest/swift.json` key, and a DOM-presence
smoke test asserting
`<custom-header>` mounted (§7.10 item 3) — the check that catches the unverified
shadow-DOM script gap before it ships silently broken.

## Open risks

- **Script execution inside the cloned header/footer template is unverified**, and both
  gating flags are Apple's own unstable naming, undocumented in either README —
  `swift-docc` landed a competing experimental HTML feature on 2026-09-02, the same day
  as this research. Re-check both on every toolchain bump, and test the switcher's mount
  script against a real deployed build, not just a local preview.
- **No canonical-tag mechanism exists at all**, and no head-injection flag to add one via
  a fragment either — the worst case among all eight languages for ledger §2.3's
  stable/latest duplicate-content mandate. No fix is designed here; a post-build text
  insertion into each shipped `index.html` is an option, untested.
- **S3 key round-tripping for symbol names containing parentheses and colons** is a real,
  not hypothetical, risk: the current `libtmux-swift` archive already contains 467 such
  paths under `documentation/libtmux/` alone (`discover(in:tmuxexecutable:)`,
  `!=(_:_:)`, and similar). Percent-encoding mismatches between an upload tool and
  CloudFront's URI normalization are a known silent-403 bug class; not verified against a
  real S3 upload in this pass.
- **Swift Package Index's own build is an unverified quantity** for the header/footer:
  `theme-settings.json` likely reaches it (no flag gates discovery), but whether its
  invocation also passes `--experimental-enable-custom-templates` is unchecked.
