# The design-token bridge

Eight generators — Sphinx/Furo, Doxygen-via-Breathe-into-Sphinx, an api-extractor-fed
Astro renderer, a docfx-metadata-fed Astro renderer, doc2go, rustdoc, Dokka, and DocC —
must read as one site, and five of the eight have no JavaScript build step to plug a
design system into at all. The bridge is not "inject a stylesheet": it is three
versioned, runtime-loaded artifacts (`tokens.css`, a header/footer partial, and a
version-switcher-plus-dark-mode script), a Tailwind v4 plugin the shell and the Sphinx
theme both import as source, and — per generator — a translation table from libtmux's
~25 semantic tokens onto whatever variable system that tool shipped with. The hardest of
those tables (rustdoc, Dokka, DocC) run into the hundreds of source properties on the
other side and stay genuinely brittle across tool upgrades.

## 1. Distributing the token layer

The token source of truth already exists.
`~/work/python/gp-sphinx/packages/gp-furo-tokens/src/contract.ts` declares **157** CSS
custom-property names as two `as const` arrays: `FURO_TOKEN_NAMES` (153 entries, verbatim
Furo `--color-*`/`--font-*`/`--sidebar-*`/`--toc-*`/`--api-*`/`--admonition-*` properties
harvested from upstream Furo's SCSS) and `GP_SPHINX_ROLE_NAMES` (4 workspace-only
`--gp-sphinx-type-*` aliases in `roles.ts`, re-expressions of the Furo scale rather than
a parallel one — ledger §4). `light.ts`/`dark.ts` hold the literal values — e.g.
`--color-background-primary` is the literal `"white"` in light mode, `#131416` in dark.
`plugin.ts` is a Tailwind v4 plugin (`tailwindcss/plugin`, `api.addBase`) emitting all 157
onto `body`, `body[data-theme="dark"]`, and
`@media (prefers-color-scheme: dark) body:not([data-theme="light"])`.

That package's own `package.json` says `"private": true` — it has never been published.
**Five of the eight language ports have no Node process to plug a Tailwind `@plugin`
import into at all**: Python and C++ run Sphinx, Rust runs rustdoc, Java+Kotlin runs
Dokka, and Swift runs DocC — each consuming a `<link>`, a `--extend-css` file, or a
`customStyleSheets` Gradle list, never an npm package. The primary distribution artifact
therefore has to be **compiled, static CSS**, published to a stable URL in the same
bucket the docs already deploy to — call it `libtmux.org/_shell/v1/tokens.css`. A build
script (the `declarations()` helper already in `plugin.ts` does the flattening) walks
`FURO_LIGHT_TOKENS` / `FURO_DARK_TOKENS` / `GP_SPHINX_ROLE_TOKENS`, renames the surviving
subset to a `--lt-*` namespace (below), and writes the three-block CSS file — the
artifact those five generators reference (§2 specifies how, without violating the
runtime-loading rule in ledger §6).

The other three ports need no CSS file, because they aren't foreign HTML being skinned —
they're pages the Astro shell renders itself. TypeScript's api-extractor JSON and .NET's
`docfx metadata` YAML both feed **our own** Astro page components (ledger §1, §2.1): we
write every element, so there is no foreign markup to fight and no adapter. Go is one
step short of that — doc2go's `-embed` output is a body-only fragment our own Astro page
wraps (ledger §7.2), but the fragment still carries doc2go's own class names, needing a
small scoped stylesheet mapping them onto `--lt-*`. That stylesheet ships inside the
shell's own Tailwind build, though, not injected into someone else's build via an
external flag. All three ride the same Vite build as the shell, so none needs the
compiled `tokens.css` file at all — this is exactly the "shell change helps here" point:
under the earlier Starlight plan, even the shell's own pages would have needed a
compiled-CSS handoff from `gp-furo-tokens`. Under the owned Astro shell (Tailwind v4 via
`@tailwindcss/vite`, per
`~/work/typescript/social-embed/packages/site/astro.config.ts`), the shell and the Sphinx
theme both `import` the same TypeScript source. Only the five non-Node generators need
the compiled-CSS handoff, regardless of shell choice — Doxygen, rustdoc, Dokka, and DocC
were never going to grow a Vite pipeline.

Secondarily, drop `"private": true` on `gp-furo-tokens` and publish it to npm — narrower
value, but real: `libtmux-ts` (a bun workspace at `~/work/libtmux/libtmux-ts`) and future
TypeScript tooling get typed token maps instead of a CSS file to parse, and it stops
`gp-furo-theme`, the shell, and sibling `git-pull.com` sites (`tmuxp`, `vcspull`, `g` —
all consumers of `gp_sphinx.config.merge_sphinx_config`, ledger §4) from each vendoring a
package that already exists.

**Rejected: vendoring.** Copying the compiled CSS into each of the eight language repos
guarantees drift the first time a color changes and one copy doesn't get updated, with
nothing forcing the other seven to notice. **Rejected: a git submodule** pointing at
`gp-sphinx` or a new shell repo — it buys nothing a stable URL doesn't already provide,
and forces Rust, Java, Swift, C#, C++, and Go CI to run `git submodule init` purely to
read one CSS file, when today none of them need Node tooling at all. A static URL is the
one thing every one of the eight build systems — `curl`, a CI step, or a theme-directory
copy at build time — can consume identically.

## 2. The three shared runtime artifacts

Per the standing rule in ledger §6 — load shell chrome at runtime from a stable URL, not
baked into each build, so a chrome fix reaches already-published immutable version
prefixes without a rebuild — the contract is three files, one version number, one URL
prefix (`libtmux.org/_shell/v1/`):

| Artifact | Contents | Consumed by |
|---|---|---|
| `tokens.css` | `--lt-*` custom properties, light default + `[data-theme="dark"]` + `prefers-color-scheme` blocks | Referenced by URL, never copied — see below |
| `shell.html` | An unstyled `<nav>`/`<footer>` fragment carrying only `data-lt-*` hooks — logo, language-switcher slot, version-switcher mount point. No generator-specific classes. | Every generator's own header/footer injection point, verbatim |
| `shell.js` | The version switcher (reads `versions.json`, renders a `<select>` into `[data-lt-version-switcher]`) plus the dark-mode shim (§4) | Loaded as a `<script>` alongside `shell.html`, wherever that generator allows a script tag |

`versions.json` needs one exclusive key per language port (ledger §6's "no shared
mutable state to race on"), each holding its own `stable`/`latest` pointers and tag list:

```json
{
  "py": { "stable": "v0.46.2", "latest": "v0.46.2", "tags": ["v0.46.2", "v0.45.0"] },
  "rs": { "stable": "v2.1.0", "latest": "v2.1.0-rc.1", "tags": ["v2.1.0", "v2.0.0"] }
}
```

This is also how ledger §2.4's caveat 3 gets satisfied — "the switcher UI does not
exist" in sphinx-multiversion, and it must match the shell's. It does: Sphinx pages load
the same `shell.js` switcher as every other language, reading `versions.json`'s `py` key,
rather than a widget built from sphinx-multiversion's own `vpathto()` Jinja context.

`tokens.css` carries roughly 25 semantic tokens, a deliberate narrowing from Furo's 157 —
no other generator has a slot for `--sidebar-search-icon-size`, and inventing 132 tokens
nothing else can use just recreates Furo's surface as the "shared" contract. The set,
grounded in the real `light.ts`/`dark.ts` values above:

| `--lt-*` token | Light | Dark | Furo source |
|---|---|---|---|
| `--lt-color-bg` | `white` | `#131416` | `--color-background-primary` |
| `--lt-color-bg-secondary` | `#f8f9fb` | `#1a1c1e` | `--color-background-secondary` |
| `--lt-color-fg` | `black` | `#cfd0d0` | `--color-foreground-primary` |
| `--lt-color-fg-muted` | `#6b6f76` | `#81868d` | `--color-foreground-muted` |
| `--lt-color-border` | `#eeebee` | `#303335` | `--color-background-border` |
| `--lt-color-accent` | `#0a4bff` | `#3d94ff` | `--color-brand-primary` |
| `--lt-color-link` | `#2757dd` | `#5ca5ff` | `--color-brand-content` |
| `--lt-color-code-bg` | `#f8f9fb` | `#1a1c1e` | `--color-inline-code-background` |
| `--lt-color-added` | `#21632c` | `#3db854` | `--color-api-added` |
| `--lt-color-removed` | `#b30000` | `#ff7575` | `--color-api-removed` |

Plus `--lt-font-sans`, `--lt-font-mono`, `--lt-radius`, `--lt-color-changed`, and
`--lt-color-deprecated` — 15 named here, ~25 total once every admonition-adjacent color
is accounted for.

**"Never copied" needs a mechanism, not just a rule.** rustdoc's `--extend-css` and
Dokka's `customStyleSheets` both bake a file path into the build — but what gets baked in
is each generator's small mapping stylesheet (§3), not `tokens.css` itself; its first
line is `@import url("https://libtmux.org/_shell/v1/tokens.css");`. The mapping
(`--main-background-color: var(--lt-color-bg)`) is fixed at build time; the *value*
`--lt-color-bg` resolves to stays live at the CDN, so a chrome-color fix reaches every
published immutable version without a rebuild — ledger §6 — even for generators with no
runtime fetch of their own.

One selector choice from `plugin.ts` does **not** carry over. Furo's own 157-token
emission targets `body`, not `:root`, because Furo's alias tokens —
`--color-content-foreground: var(--color-foreground-primary)`, confirmed at
`light.ts:194` — only re-substitute when declared at the same specificity as the token
they reference; alias at `:root` while the override lands on `body[data-theme="dark"]`
and the alias freezes at its `:root`-scope value forever. `tokens.css`'s ~25 `--lt-*`
tokens are flat literals with no aliasing between them, so that trap doesn't apply, and
`tokens.css` keys dark mode on `:root[data-theme="dark"]` — the *shell's* own
`html[data-theme]` convention, not any one generator's `body`. That puts a real job on
the shim in §4: on every page it must set the canonical `html[data-theme]` attribute
`tokens.css` reads, in addition to writing through to the native key — Furo sets
`body[data-theme]`, Dokka a class on `<html>`, DocC `body[data-color-scheme]`, none of
which would ever match `:root[data-theme="dark"]` alone.

The inline-`<style>`-in-`<head>` pattern `tokens.css` borrows for dark mode is already
proven in production, once correctly attributed: the partial lives in `gp-furo-theme`'s
Jinja/Sass layer, at `theme/gp-furo/partials/_head_css_variables.html` — a port of
upstream Furo's own partial — and `sphinx-gp-theme`, the theme actually serving
`libtmux.git-pull.com` today (ledger §4), inherits it unchanged via Sphinx's
theme-inheritance chain (`theme.conf: inherit = gp-furo`). The Tailwind rewrite in
`gp-furo-theme`'s `web/` pipeline is not yet the production path; this template partial,
underneath it, already is.

## 3. The per-generator adapter problem

`tokens.css` does not restyle anything by itself. Each of the five non-Node generators
paints from its own variable system — `--lt-color-accent` means nothing to rustdoc's
`--main-color` — so each needs a translation table: a small adapter stylesheet (a JSON
file, for DocC) mapping the ~25 `--lt-*` names onto that tool's real properties, loaded
through its own override mechanism.

| Generator | Native variable system | Injection mechanism | Approx. mappings needed | Brittleness |
|---|---|---|---|---|
| Furo (Python, C++) | `--color-*`, 153 names, source of the contract | `theme_light_css_variables`/`dark_css_variables` → inline `<head>` `<style>` | 0 — this *is* the contract | None; we own both ends |
| rustdoc | `--main-*`, flat, no raw/semantic split | `--extend-css <path>` (adds rules) + `--html-in-header` for the shell partial | ~15 of ~105–128 total names (ledger §7.8: unreconciled, do not quote either number as final) | Low — vocabulary stable since the 2023 rustdoc CSS-variable rewrite |
| Dokka (Java+Kotlin) | `--default-font-color`/`--background-color`/etc. (~20 semantic), plus a 2,000+-property chrome file mostly unused | `customStyleSheets` (Gradle) + `templatesDir` for `.ftl` header/footer | ~20 semantic, plus one FreeMarker override | Medium — `header.ftl` hardcodes `class="navigation theme-dark"` regardless of page theme; two separate fixes |
| javadoc | ~34 flat properties, declared once, no dark-mode plumbing at all | `--add-stylesheet <file>` (appends) + `-header`/`-footer`/`-top`/`-bottom` | ~34, light only | Low for color; dark mode isn't brittle, it's absent |
| DocC (Swift) | ~297 `var(--color-*)` usages; override channel is a JSON object walked into properties at runtime, not CSS | `theme-settings.json` (colors); `header.html`/`footer.html` fragments (chrome — below) | Unknown — dotted-path keys reverse-engineered from `_light.scss`, undocumented | High — no CSS fallback if a path is wrong |

Two of these lines need a correction against the raw research corpus, which the ledger's
verification pass resolved and which this document follows (ledger §7.1, superseding the
"no HTML header/footer slot exists" framing found in `cross-design-bridge.json`):

**DocC does have a header/footer injection point**, and it needs no custom-element
JavaScript on your side: you write `header.html` as a plain fragment at the top of the
`.docc` catalog (filenames fixed, per `DocumentationCatalogFileTypes.swift:64,72`); `docc
convert` wraps it in `<template id="custom-header">…</template>` and splices it after
`<body>` (`ConvertFileWritingConsumer.swift:243`); docc-render's bundled
`CustomComponents` Vue plugin calls `customElements.define()` against that id; and
`App.vue` renders `<custom-header v-if="hasCustomHeader">` once registered. You supply
the fragment; docc-render supplies the wiring. Two caveats survive: whether a `<script>`
inside the fragment executes is **unverified** — it is cloned into a Shadow DOM before
mounting, and script-execution-on-clone is not guaranteed — so test before relying on it
to mount the version switcher; and the mechanism sits behind Apple's undocumented
`--experimental-enable-custom-templates` flag, unstable across toolchain bumps by its own
naming.

**.NET and DocFX's own theme are not part of this bridge.** The ledger routes the .NET
reference through `docfx metadata` YAML into our own Astro renderer (§1), not DocFX's
bundled `modern` HTML template. That template's real Bootstrap 5.3 dual-variable
brittleness (every color needs a plain and an `-rgb` twin, since component styles read
`rgba(var(--bs-primary-rgb), .5)`) is a Thin-Shell-fallback cost (ledger §5), not one this
architecture pays — .NET's pages are ours to write, exactly like TypeScript's.

Sample injection commands for three generators with real per-tool CSS brittleness.
javadoc appears as a worked example only — ledger §1 routes Java+Kotlin through Dokka
alone, so javadoc isn't one of the eight shipping surfaces, but `./gradlew javadoc` run
separately hits exactly this flag set:

```console
$ RUSTDOCFLAGS="--extend-css lt-rustdoc-adapter.css --html-in-header lt-shell-header.html" \
    cargo doc \
    -p libtmux \
    --no-deps
```

```console
$ javadoc \
    --add-stylesheet lt-javadoc-adapter.css \
    -header '<script src="/_shell/v1/shell.js" defer></script>' \
    -d build/docs/javadoc
```

Dokka's Gradle `DokkaHtmlPluginParameters` takes the adapter stylesheet and the template
override together; `templatesDir` overrides `header.ftl`'s hardcoded `theme-dark` class.

```kotlin
pluginsConfiguration.html {
    customStyleSheets.from(file("lt-dokka-adapter.css"))
    templatesDir.set(file("lt-dokka-templates"))
}
```

## 4. Dark mode: shim, don't replace

Every generator keeps its own toggle, its own storage key, and its own paint-time
attribute — replacing any of them means re-implementing that generator's restyle logic,
which is exactly the ongoing-fork cost this whole design avoids. The right shape is a
~40-line shim, shipped inside `shell.js`, that owns one canonical preference and
write-throughs it into whatever native key each generator already reads:

| Generator | Native storage key | Native attribute | "auto" value |
|---|---|---|---|
| Furo | `theme` (confirmed: `localStorage.setItem("theme", mode)` in `gp-furo-theme`'s `furo.ts`) | `body[data-theme]` | `"auto"` |
| rustdoc | `rustdoc-theme` + `rustdoc-use-system-theme` | `html[data-theme]` | `use-system-theme=true` |
| Dokka | `dokka-dark-mode` (boolean) | `html.theme-dark` class | key absent |
| DocC | `developer.setting.preferredColorScheme` (legacy fallback: `docs.setting.preferredColorScheme`) | `body[data-color-scheme]` | `"auto"` |
| Astro shell (`social-embed` precedent) | `starlight-theme` | `html[data-theme]` resolved, `html[data-theme-preference]` for the three-state UI | `"auto"` |

On toggle, the shim writes the canonical key, then the corresponding native
key/attribute for whichever generator's page is open — it never fights a generator's own
boot script. On load, most generators (Furo, rustdoc, Dokka) set their native attribute
synchronously, pre-paint, to avoid a flash; let that stand and correct it only on
mismatch with the canonical key, accepting a one-frame flash rather than rewriting every
generator's inline boot script to defer to ours.

**What cannot be unified: two visible toggles on every non-Astro page, not one.** The
shared `shell.html` header carries its own light/auto/dark control, and rustdoc, Furo,
and Dokka each ship a native toggle the shim does not remove — removing it means
reimplementing that generator's click handler, the exact fork this design avoids. Both
read the same synced state, so they cannot disagree, but a page can legitimately show a
theme switch twice. That is a real, visible seam this bridge does not close; once the
shim is proven to track correctly, a later pass on `shell.html` can hide the native
control via adapter CSS (`display: none` on Furo's `.theme-toggle`, rustdoc's theme
picker).

The Astro shell's own theme system, in
`~/work/typescript/social-embed/packages/site/src/layouts/BaseLayout.astro`, is a
two-attribute design worth carrying forward: `data-theme-preference` holds the user's
three-way choice (`light`/`auto`/`dark`), `data-theme` holds the *resolved* two-way paint
value CSS keys off. Every generator in the table above conflates the two into one
attribute; the split is what lets the shell's toggle track live OS changes without a
reload, and the shim should propagate the resolved value into each generator's native
attribute, not the preference.

**What the ledger leaves open, and this document does not close (§7.13):**
`social-embed` persists under `starlight-theme` deliberately, for backward compatibility
with already-deployed users — that key cannot simply be renamed out from under them. The
cross-generator shim needs a canonical key of its own; `libtmux-theme` is the natural
candidate, but `localStorage` is scoped per origin, so this matters only if
`libtmux.org` and `social-embed.org` (or another `git-pull.com` property) are meant to
share a dark-mode preference across visits — not yet decided. Three options stand:
migrate `social-embed` to a neutral key and accept a one-time reset for existing users;
have the shim read both `libtmux-theme` and `starlight-theme` and treat either as
authoritative; or accept per-site preferences and drop cross-site sync entirely. Pick one
before `shell.js` ships — not a decision this document makes.

## 5. Fonts

`~/work/typescript/social-embed/packages/site/astro.config.ts` already does the pattern
to copy: the Astro Fonts API (`fontProviders.local()`, stable since Astro 6.0.4) pointed
at `@fontsource` package files on disk — no runtime fetch to Google Fonts or jsDelivr,
`display: "swap"`, one `<Font cssVariable="…" preload />` per family in
`BaseLayout.astro`'s `<head>`. That is the model for every Astro-rendered surface:
TypeScript, .NET, Go, the shell itself.

The Sphinx side has a parallel mechanism that does *not* currently run for libtmux:
`~/work/python/gp-sphinx/packages/sphinx-fonts/src/sphinx_fonts/__init__.py` downloads
the same Fontsource woff2 files at build time into that build's own `_static/fonts/`. It
works, but each Sphinx build re-fetches and re-embeds its own copy — wasteful once
Python, C++, and every version prefix of both pull the same bytes repeatedly. Bake the
woff2 files once into `libtmux.org/_shell/v1/fonts/*.woff2` instead, and have
`sphinx-fonts` and the five non-Node adapters reference that one path via `@font-face`
rather than vendoring — same "one artifact, many consumers" logic as `tokens.css`.

This is also the strongest concrete argument, beyond ledger §1's URL-hygiene reasons,
for path-prefix routing (`libtmux.org/py/`, `/rs/`, `/ts/`) over subdomains
(`py.libtmux.org`): `@font-face { src: url(/_shell/v1/fonts/x.woff2) }` is same-origin
from every prefix under one domain and needs no `Access-Control-Allow-Origin` header,
where subdomains would need CORS configured and kept correct on all eight, purely to
serve font files that never change per language.

## 6. Realistic effort, and what not to skin

| Generator | Adapter effort | Why |
|---|---|---|
| Python, C++ (Sphinx/Furo) | Already done | `gp-furo-tokens` *is* the contract; publishing it is packaging work, not design work |
| TypeScript, .NET, Go | Low, but it's page-design work, not token-adapter work | Rendered by our own Astro components; they `@plugin` the token source directly, same build as the shell |
| Rust (rustdoc) | Low | One CSS file, one `RUSTDOCFLAGS` entry, ~15 stable mappings |
| Java+Kotlin (Dokka) | Medium | ~20 mappings plus a mandatory `.ftl` header override for the hardcoded dark nav bar |
| Swift (DocC) — chrome only | Low | `header.html`/`footer.html` is a real, verified fragment-drop mechanism (ledger §7.1) |
| Swift (DocC) — color parity | High, and not worth deep investment | JSON-only, undocumented dotted-path keys reverse-engineered from Sass; ship a coarse light/dark match via `theme-settings.json` and stop |
| javadoc — color parity (not one of the 8 shipping ports; §3) | Low | 34 flat vars, one flag |
| javadoc — anything beyond that | Not worth it | No dark-mode hook exists anywhere in the generated output; there is nothing to extend |

The two genuine "don't chase full parity" cases are **javadoc's dark mode** (no toggle,
no `prefers-color-scheme`, no `data-theme` anywhere in the generated output — building
one means a bespoke restyle layer for a tool never designed for it) and **DocC's deep
color match** (every token guesses an undocumented internal path, and a wrong guess fails
silently rather than falling back to a default). Both still get the shared
`shell.html`/`shell.js` chrome — DocC's via the verified `header.html`/`footer.html` drop,
javadoc's via `-header`/`-footer` injection — so both carry the version switcher and link
back to the unified nav. What they don't get is pixel parity on every internal surface,
and that line should be drawn explicitly, not discovered during QA.
