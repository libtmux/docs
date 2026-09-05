# libtmux.org — decisions and verified fact ledger

Authoritative. Where any other document in this folder disagrees with this file, this
file wins. Every claim below survived an adversarial verification pass that ran the
tools and read the source rather than trusting changelogs.

Date: 2026-09-02. Research base: 27 research agents + 10 adversarial verifiers +
4 architecture proposals + 3 judge lenses; ~45 repositories shallow-cloned to `~/study/`.

---

## 1. The recommendation

**A hand-owned Astro site owns the shell. Two renderers produce reference pages. Four
languages keep their native generator, skinned.**

No Starlight. No documentation framework of any kind. Astro is used as a build tool and
a component model; every layout, every component and every piece of routing is ours.
See §1.1 for why, and `01-architecture-options.md` for the alternatives.

| Layer | Choice |
|---|---|
| Shell (`/`, concepts, guides, examples, parity, search, i18n) | Astro 7, own layouts and components |
| Python reference | Sphinx + `sphinx-gp-theme` — unchanged from today |
| C++ reference | Doxygen XML → Breathe → Sphinx (same theme as Python) |
| TypeScript reference | api-extractor JSON → our Astro renderer (forced, see §2.1) |
| .NET reference | `docfx metadata` YAML → our Astro renderer |
| Go reference | doc2go in `-embed` mode, wrapped by our Astro renderer |
| Rust reference | rustdoc, skinned via `--extend-css` / `--html-in-header` |
| Java + Kotlin reference | Dokka HTML, skinned via `customStyleSheets` / `templatesDir` |
| Swift reference | DocC + `theme-settings.json` + `header.html` / `footer.html` |

URL scheme: **path prefixes on one domain**, not subdomains.

```
libtmux.org/                     shell, English
libtmux.org/ja/                  shell, Japanese
libtmux.org/py/v0.46.2/          immutable version
libtmux.org/py/stable/           separate build, own canonical
```

### 1.1 Why no Starlight — and why that costs almost nothing

The decision is Tony's, from direct experience: Starlight was adopted for
`social-embed.org` and then removed again. The migration is a documented commit trail in
`~/work/typescript/social-embed`, culminating in PR #55, "Migrate from Starlight to pure
Astro" (`09ec34f2`), preceded by `5b1f352a` replacing `StarlightPage` with a `BaseLayout`,
`96c8b3f9` removing component overrides, and `cfabf5ee` removing the dependencies. The
stated reason is lock-in: being pinned for years to someone else's component API and
upgrade cadence.

The research independently supports the same conclusion. The two things Starlight was
going to buy us both evaporated under verification:

- **Versioning.** Starlight has **none**. Verified: zero matches for "versioning" in a
  3,017-line changelog, and discussion #957 open and stale since 2024-06-12. The only
  option is `starlight-versions`, a 99-star community plugin whose own README calls
  itself early development. We were going to have to build versioning ourselves anyway.
- **Search.** Starlight ships Pagefind "with zero config", which sounds like a real
  advantage until you look at the integration: it is roughly 40 lines that shell out to
  the Pagefind CLI on `astro:build:done`. `social-embed` already has its own
  (`packages/site/plugins/astro-pagefind-integration.ts`), whose header comment says
  outright that the pattern was borrowed from Starlight's.

What is genuinely lost is Starlight's first-party i18n routing. That is real but small,
and §3 explains why owning it is actually better for our URL shape.

### 1.2 The shell already exists — port it, do not design it

`~/work/typescript/social-embed/packages/site` is a working, owned Astro documentation
site. It is the starting point, not a reference to admire:

| Piece | Path under `packages/site/` | Relevance to libtmux.org |
|---|---|---|
| Base page shell | `src/layouts/BaseLayout.astro` | header, footer, theme, `head` injection |
| 3-column docs layout | `src/layouts/MarkdownLayout.astro` | sidebar, content, ToC, mobile panels |
| Header with slots | `src/components/core/CoreHeaderLayout.astro` | the extension point for a language switcher |
| Section-scoped sidebar | `src/components/docs/Sidebar.astro` | already branches on `/lib/` vs `/wc/` — becomes `/py/` vs `/ts/` |
| ToC + mobile panels | `src/components/docs/{TableOfContents,Mobile*}.astro` | reusable as-is |
| MDX components | `src/components/mdx/{Tabs,TabItem,Aside,Badge,LinkButton}.astro` | `Tabs` is the "same task in eight languages" component |
| Search UI | `src/components/search/usePagefindSearch.ts` | React island over the Pagefind index |
| Pagefind build hook | `plugins/astro-pagefind-integration.ts` | reusable verbatim |
| Content collection | `src/content.config.ts` | `glob()` loader + `z.looseObject` schema |

The stack is Astro 7, Tailwind 4, MDX, `astro-expressive-code`, Pagefind, the Astro Fonts
API with local `@fontsource` files, and the `satteri` Markdown processor with two small
hast plugins. TypeScript throughout, Biome for lint and format.

**Be honest about what this does not prove.** `social-embed` is a single-locale,
single-version site covering two packages with no external generator ingestion.
libtmux.org extends it in exactly the three directions that are hard: many versions, many
locales, and ingesting eight foreign API models. The shell is solved. The pipeline is not.

The extension point for the pipeline is the content collection. Astro's Content Layer API
has been stable since Astro 5 and ships a `file()` loader for JSON/YAML/TOML — verified —
so api-extractor JSON, docfx YAML and doc2go fragments enter as typed collections
alongside hand-written MDX. The loaders are a small amount of new code. The normalisers
that feed them are the real work.

**Three loaders, not eight.** Only TypeScript, .NET and Go render through the Astro
shell. Python and C++ render through Sphinx; Rust, Java/Kotlin and Swift keep their own
generators and are skinned. Nothing outside those three ever enters an Astro content
collection.

One thing the topology implies but nobody has decided: those three Astro renders run in
their own port repositories' CI (§7.7), so each needs to import the shell's layouts and
`Pure*` components from a single source rather than copy-pasting them. Packaging the
shell components — a published package, a git submodule, or a workspace — is an open
question. Record it as a Phase 1 task.

### Why not the alternatives

The judge panel scored four architectures on three lenses (0-10):

| Proposal | Solo-maintainer | Uniformity | Ops risk | Total |
|---|---|---|---|---|
| Astro shell + native tier2 | 6.5 | 5 | 7.5 | **19.0** |
| Thin Shell, Native Ref, Shared Skin | 8 | 2 | 8.5 | 18.5 |
| The Unified Doctree (Sphinx-maximalist) | 4 | 7 | 3 | 14.0 |
| libtmux API Model (Pulumi-style) | 3 | 4 | 6 | 13.0 |

Do not read 19.0 vs 18.5 as decisive — it is a coin flip. The argument is:

1. **Thin Shell is a self-admitted retreat from the stated goal.** It sends Go to
   pkg.go.dev and Java to javadoc.io: different domain, different fonts, not one CSS
   token in common, and nothing you could style later because you do not control those
   hosts. The uniformity judge — which ranked it **last**, at 2/10 — said it should reach
   you as a named, conscious trade-off rather than as a design graded as meeting the ask.
   The two judges that ranked it first framed its cost differently: bespoke-renderer debt
   (solo-maintainer lens) and third-party availability risk (ops lens). It is the correct
   fallback if effort becomes the binding constraint — see §5.

   (An earlier draft attributed the "named, conscious trade-off" phrasing to the two
   judges that ranked Thin Shell first. That was wrong; it came from the judge that
   ranked it last.)
2. **The winning proposal's weakest score rests on a false premise.** It scored Swift
   3/10 by claiming swift-docc-render has no HTML injection point. That is wrong; the
   `header.html` / `footer.html` mechanism is real and verified (§7.1). Corrected, its
   uniformity score rises.

All four proposals were written assuming Starlight as the shell technology. Substituting
an owned Astro shell does not change their relative ranking — the shell was never the
axis they differed on — but it removes the `starlight-versions` risk from every one of
them. See §7.12.

---

## 2. Verified facts that change the design

Each item below was tested, not assumed.

### 2.1 TypeDoc is unusable for libtmux-ts — hard blocker

Not a soft peer-dependency warning. TypeScript 7.0.2 is the Go-native compiler rewrite;
its `package.json` maps the root import to `lib/version.cjs`, which exports only
`version` and `versionMajorMinor`. The classic Compiler API is absent from the package
(zero matches for `SyntaxKind` anywhere under the installed `typescript`).

TypeDoc 0.28.20 therefore crashes at ESM module-load time — even `typedoc --version`
throws `TypeError: Cannot read properties of undefined (reading 'PropertyDeclaration')`.
No flag or peer-dependency override recovers it. Tracked upstream at
TypeStrong/TypeDoc#3098, open, maintainer states no timeline.

Everything built on TypeDoc is blocked identically: `typedoc-plugin-markdown`,
`starlight-typedoc`, `sphinx-js`.

`@microsoft/api-extractor` 7.59.0 works today. It bundles its own `typescript@5.9.3`,
declares `peerDependencies: null`, and parses emitted `.d.ts` rather than compiling
source, so it never touches the project's TypeScript 7. Verified end to end: a fresh
project build produced `.d.ts`, then api-extractor completed successfully and emitted a
936,568-byte `index.api.json` with warnings only.

**Consequence:** the TypeScript lane has no themable HTML generator at all. Page
rendering must be hand-built against the api-extractor JSON model. Under an owned Astro
shell this is less of an outlier than it first looked — we are hand-building the page
components anyway, and api-extractor's JSON is simply another content-collection source.

### 2.2 Swift DocC does not need SPA route rewriting — claim refuted

`StaticHostableTransformer.transform()` walks every `data/**/*.json` in the archive and
writes a real `index.html` into a matching directory for each one. Every documentation
route is a genuine S3 object. No SPA fallback, no catch-all rewrite.

**Consequence:** the CloudFront Function stays small. It handles trailing-slash and
directory-index behaviour uniformly for all eight languages; Swift needs no special case.

DocC is, however, the one generator that bakes an **absolute** base path:
`--hosting-base-path` is a literal substitution of the `{{BASE_PATH}}` token into every
route's `index.html`, and docc-render's compiled bundle sets its `publicPath` to the same
placeholder. DocC output cannot be served at two prefixes.

### 2.3 `/stable/` and `/latest/` must be separate builds — for a different reason than assumed

The original argument (generators bake absolute navigation paths) is **false for 6 of 7**
generators checked. Sphinx (`pathto()` / `relative_uri()`), rustdoc (`root_path()`),
TypeDoc (`baseRelativeUrl`), Dokka (`pathToRoot`), DocFX (`_rel`) and doc2go all compute
page-depth-relative links. Only DocC bakes an absolute path (§2.2).

The axis that actually decides it is **canonical tags and sitemaps**, which bake absolute
URLs at build time regardless of link relativity. Serving identical bytes at
`/py/v0.46.2/` and `/py/stable/` produces true duplicate content with no dedup signal.

Empirically confirmed against the flagship precedent: `doc.rust-lang.org` serves
byte-identical content at `/book/` and `/stable/book/` — identical `x-amz-version-id` —
with **no canonical tag on either URL**.

**Decision:** build `/stable/` and `/latest/` as real, separate builds with the base-path
and canonical flag set to the alias URL, for all eight languages. Reserve the CloudFront
Function plus KeyValueStore for the bare-language-root redirect only
(`/py` → 302 → `/py/stable/`), never to rewrite an already-qualified URL to different bytes.

Note: libtmux's Sphinx docs emit **no canonical tag at all** today — `html_baseurl` is
unset in both the project `conf.py` and gp-sphinx's `config.py`.

### 2.4 sphinx-multiversion: the mechanism is real, the project is in a maintenance stall

The core trick is confirmed and was reproduced empirically. `main.py` computes
`confdir_absolute` once, outside the per-ref loop, and passes `-c confdir_absolute` to
every `sphinx-build`. Content comes from each ref via `git archive`. A marker string
injected into only the uncommitted working-tree `conf.py` and `custom.css` appeared in
the built output of tags v0.20.0 and v0.40.0, while each tag's prose matched its own
commit. "Old content, current design system" is genuine, and it is deliberate — commit
ab9bac8 (2020-08-05) is titled "Always use original conf.py file".

Four caveats, all verified:

1. **Broken against Sphinx 9.** Crashes at startup with
   `TypeError: Config.read() takes 2 positional arguments but 3 were given`. The
   project's own CI has failed with this traceback on every push since 2026-04-20.
   PR #202 fixes it in 16 lines and was verified working, but has sat unmerged for
   8 months. Issue #203, "Is this project still maintained?", has no response.
2. **Not blocking today.** gp-sphinx pins `sphinx>=8.1,<9`, so the stack cannot install
   Sphinx 9 anyway. Track it for the moment that pin is raised; vendor PR #202 then.
3. **The switcher UI does not exist.** multiversion supplies only a Jinja context
   (`versions.branches`, `versions.tags`, `vpathto()`) and one bullet-list example
   partial. The widget must be built into `sphinx-gp-theme` — and it must match the one
   the Astro shell ships, since both render the same control.
4. **Refs are silently dropped** when their historical `conf.py` fails to import under
   today's installed packages. Tag v0.10.0 was excluded because it imports `alagitpull`
   and `sphinx_issues`. No build failure — a silent omission. Upstream issue #165, open
   since 2025-03-17, no response.

sphinx-polyversion is healthier by every hygiene metric (PyPI 3.0.0 matches its git tag,
4 open issues vs 57) but is architecturally the **opposite** fit: it builds each version
in its own isolated venv with that version's own `conf.py`, giving "old content, period-
correct design" — precisely what we do not want.

Note this applies only to the Sphinx-rendered languages (Python, C++). The Astro-rendered
and skinned-native languages get versioning from our own build-per-prefix loop, which has
no such dependency.

### 2.5 Infrastructure claims

| Claim | Verdict |
|---|---|
| S3 conditional writes (`If-None-Match: *`, `If-Match: <etag>`) give true compare-and-swap | **Confirmed.** GA since Aug 2024. Requires `aws s3api put-object`, not `aws s3 cp`/`sync`. |
| GitHub Actions `concurrency: {group, queue: max}` | **Confirmed.** Announced 2026-05-07. Raises pending runs per group to 100, FIFO. Cannot combine with `cancel-in-progress: true`. |
| CloudFront KeyValueStore readable from a CloudFront Function | **Partially true.** Real, but reads are Promise-based (`await kvsHandle.get()`), not synchronous. Limits: key ≤512 B, value ≤1 KB, store ≤5 MB, 1 KVS per function. Update propagation delay has no published SLA — do not state a number. |
| Astro 7 ships a Rolldown build pipeline | **Confirmed.** Astro 7.0 shipped 2026-06-22; Rolldown arrives transitively via Vite 8. `social-embed` is already on Astro 7.2.7 and Vite 8.2.2. |
| Astro Content Layer API is stable and can ingest external JSON/YAML | **Confirmed.** Stable since Astro 5 (Dec 2024); built-in `file()` loader for JSON/YAML/TOML plus custom loaders. This is the mechanism for the eight API models. |
| Starlight has no first-party versioning | **Confirmed** — and now moot, since we are not using Starlight. Recorded because it is the evidence that the framework was not buying us the thing we most needed. |

### 2.6 Licensing

Copyleft obligations attach to **distributing** a program, not to running it. Piping
libtmux's own source through Doxygen in CI and publishing the resulting HTML creates no
GPL obligation on libtmux.

The distinction that actually matters for the permissive preference:

- **Running a GPL binary** (Doxygen emitting XML) — no obligation. Acceptable.
- **Importing a GPL library into your process** (a GPL Sphinx extension loaded into
  `sphinx-build`) — a much stronger copyleft argument. This is why **sphinxcontrib-rust
  (GPL-3.0) is ruled out**, even though Doxygen is not.
- **Forking a GPL tool to theme it** — triggers GPL on redistribution. Never fork Doxygen.

Route C++ as Doxygen `GENERATE_XML=YES` / `GENERATE_HTML=NO` → Breathe (BSD) → Sphinx,
so no Doxygen-produced HTML is ever published and the question is moot.

---

## 3. The i18n URL shape — chosen, not forced

Two research agents disagreed on where the locale segment goes. The earlier ruling picked
locale-outermost because Starlight's i18n rides Astro's router, which only supports a
first-segment locale. **That justification is gone** now that we own the routing: an Astro
site with `[...slug]` routes can emit any URL shape we want, and we need not use Astro's
built-in `i18n` config at all.

The ruling stands anyway, now on merits:

```
libtmux.org/concepts/panes/          shell prose, English
libtmux.org/ja/concepts/panes/       shell prose, Japanese
libtmux.org/py/stable/api/           reference, never localised
```

**Locale outermost, and only shell prose is translated.** Reasons:

1. It keeps the translated and untranslated halves of the site cleanly separated. A
   locale prefix means "this subtree is translated"; its absence means reference content.
   A locale buried inside `/py/v0.46/ja/` implies per-version translated reference, which
   we are explicitly not doing.
2. `hreflang` alternates and per-locale sitemaps are simpler to generate when the locale
   is a single leading segment.
3. It matches the convention of every multi-locale documentation site examined, including
   the OpenTelemetry site's default-language-unprefixed Hugo layout.

API reference prefixes carry **no locale segment at all**. Reference content comes from
doc comments in eight source repositories; translating it means translating source
comments, which is not a workload a solo maintainer should take on.

Sphinx's gettext pipeline *can* extract autodoc docstrings — verified — but leave those
`.po` entries unfilled deliberately, for consistency with the other seven ports.

---

## 4. Correction to shared context

Earlier research prompts described `gp-furo-theme` as the design system. That is wrong
and any document repeating it should be read with this correction:

- **`sphinx-gp-theme`** (Jinja + Sass, a Furo child theme) is what renders
  `libtmux.git-pull.com` in production **today**.
- **`gp-furo-theme`** is the mostly-built Tailwind rewrite, not yet the production path.
- **`gp-furo-tokens`** declares its token contract in
  `packages/gp-furo-tokens/src/contract.ts` as **two** arrays: `FURO_TOKEN_NAMES` with
  **153** Furo CSS custom properties (lines 11-168) and `GP_SPHINX_ROLE_NAMES` with
  **4** role tokens (lines 179-187) — `--gp-sphinx-type-body`,
  `--gp-sphinx-type-code-inline`, `--gp-sphinx-type-icon-glyph`,
  `--gp-sphinx-type-metadata`. Total 157. Both arrays live in `contract.ts`;
  `roles.ts` holds the role *values*, not a third name list. The package is
  `"private": true` and not published to npm.

The remaining work on the Tailwind theme is "finish templates and QA a mostly-built
theme", not "build from a skeleton".

The design system is shared beyond libtmux: `tmuxp`, `vcspull` and `g` all call
`gp_sphinx.config.merge_sphinx_config`. Anything built here should be reusable across
that family rather than libtmux-specific.

Note the token direction of travel. `gp-furo-tokens` is a Tailwind v4 plugin and the
Astro shell is a Tailwind v4 site, so the shell and the Sphinx theme can share one token
source directly rather than through a compiled-CSS handoff. That is a genuine
simplification the Starlight plan did not have.

---

## 5. The named trade-off you should decide

The Thin Shell fallback deep-links Rust to docs.rs, Go to pkg.go.dev and Java to
javadoc.io. It deletes **those three languages' owned CI** and **the CloudFront
KeyValueStore** — not the bespoke renderers.

Two precisions, both from a cross-check of the fallback's own design:

- **Skin work is only deleted for Go and Java.** pkg.go.dev and javadoc.io offer no
  per-package customisation hook at all. Rust is different: docs.rs honours
  `[package.metadata.docs.rs]` `rustdoc-args`, so the fallback still ships Rust's
  `--extend-css` / `--html-in-header` files and still maintains them. Rust loses its CI,
  not its skin.
- **Thin Shell keeps the TypeScript and .NET renderers and the C++ Breathe bridge.** It
  reaches a lower renderer count only by falling back to `api-documenter`'s stock
  Markdown and DocFX's own output instead of building custom pages — a quality trade,
  not a deletion.

| | Recommendation | Thin Shell fallback |
|---|---|---|
| Languages with owned CI | 8 | 5 |
| Languages sharing a design token | 8 | 6 (5 self-hosted + Rust via docs.rs) |
| Languages on a domain you control | 8 | **5** |
| Languages whose skin work you still maintain | 8 | 6 (Rust included) |
| Bespoke renderers | TypeScript, .NET | same two, or stock output instead |
| C++ Breathe bridge | yes | yes |
| CloudFront KeyValueStore | yes | not needed |

An earlier draft of this table said 6 for "domain you control", which double-counted
Rust: docs.rs is not a domain you control.

Take the fallback if maintenance time is the binding constraint. Take the
recommendation if "one site" is genuinely the goal. This is your call, and it is the
only decision in this folder that the research cannot make for you.

---

## 6. Standing rules for every document in this folder

- Scope `aws s3 sync --delete` to the job's own prefix, never the bucket root. The
  current `docs.yml` syncs to the bucket root with `--delete`; under a multi-prefix
  layout that would wipe every other language.
- Load the shared header, footer, version switcher and tokens at **runtime** from a
  stable URL rather than baking them into each build, so chrome fixes reach already-
  published immutable versions without a rebuild.
- Immutable version prefixes get long `Cache-Control`; only mutable pointers
  (`/latest/`, `/stable/`, the manifest, the shell) need invalidation.
- Give each repository an exclusive manifest key so there is no shared mutable state to
  race on. Use `concurrency: {group, queue: max}` for serialisation and S3 conditional
  PUT only as a backstop.
- Never state a propagation-delay number for CloudFront KeyValueStore; AWS publishes none.
- No documentation framework. If a capability seems to require adopting one, that is a
  signal to write the fifty lines ourselves, as `social-embed` did for Pagefind.

---

## 7. Adjudications

A cross-check pass over the finished document set found twelve disagreements. These are
the rulings. Where a document still says otherwise, this section wins.

### 7.1 Swift DocC custom header and footer

A plain HTML fragment is sufficient. The full chain, read from source:

1. You write `header.html` as a plain fragment at the top level of the `.docc` catalog.
   Filenames are fixed (`DocumentationCatalogFileTypes.swift:64,72`), discovery is
   automatic (`DocumentationInputsProvider.swift:163-166`), and there is no path flag.
2. `docc convert` wraps it for you. `ConvertFileWritingConsumer.swift:243` builds the
   string `<template id="custom-header">` + your file's contents + `</template>` and
   splices it in immediately after the opening `<body>` tag. You never write the
   `<template>` wrapper either.
3. docc-render registers it for you. Its bundled `CustomComponents` Vue plugin, installed
   unconditionally at `SwiftDocCRenderPlugin.js:26`, looks up
   `document.getElementById('custom-header')` and calls `window.customElements.define()`
   at `CustomComponents.js:47`.
4. `App.vue:23,30` then renders `<custom-header v-if="hasCustomHeader">`, where
   `hasCustomHeader` is `!!window.customElements.get('custom-header')` (`App.vue:97`).

Any document claiming the file must supply its own `customElements.define()` call is
wrong. Whether a `<script>` inside the fragment executes is **unverified** — the template
content is cloned into a Shadow DOM before mounting, and script-execution-on-clone is not
guaranteed there. Test it before relying on it for the version-switcher mount.

The catalog templates are gated behind `--experimental-enable-custom-templates`. That is
Apple's own flag name and it is not documented in either repository's README — treat it
as unstable across Swift toolchain releases and re-check on every bump.

### 7.2 Go chrome injection — use `-embed`, not a template fork

**Ruling: `-embed`.** A fork must be rebased on every doc2go release, which is exactly
the standing maintenance cost this architecture exists to avoid. Verified constraint:
doc2go's `flags.go:187-191` hard-errors when `-embed` and `-pagefind` are combined, so Go
loses doc2go-native search and relies on the site-wide Pagefind crawl instead.

This fits the owned-Astro shell better than it fitted the Starlight plan: `-embed` emits
body-only HTML fragments, and a fragment is exactly what a hand-written Astro page
component wants to wrap.

### 7.3 Bucket name

`s3://libtmux-docs`, keeping the existing `LIBTMUX_DOCS_BUCKET` secret name. Any document
using `libtmux-org` as a bucket name, including in IAM policy ARNs, is wrong.

### 7.4 Rust site prefix

`/rs/`, per §1.

### 7.5 Invalidation scope

Invalidate only the mutable pointers — `/py/stable/*`, `/py/latest/*`, the manifest and
the shell. Never a whole language root such as `/py/*`: immutable tag prefixes never
change, so invalidating them is pure cost.

### 7.6 Deploy serialisation

Any `concurrency` block for a deploy job needs `queue: max`, or it falls back to the
older behaviour that drops pending runs. It cannot be combined with
`cancel-in-progress: true`.

### 7.7 .NET CI placement

The Astro satellite build for .NET runs in `libtmux-dotnet`'s own CI, like every other
port. Per-repo prefix ownership is the chosen topology; no document should put a
language's build in a shared monorepo job.

### 7.8 Unreconciled counts — treat as unverified

Two numeric disagreements were not resolved and should not be quoted as fact until
someone re-measures:

- **rustdoc custom properties**: 128 (from a real `cargo doc` build on rustc 1.98.0)
  versus 105 (from grepping the shipped CSS). Likely different scopes — all theme blocks
  versus one — but nobody checked. The adapter's size estimate depends on it.
- **Java parity ledger**: 1,454 rows all marked planned, versus 889 reconciled symbols
  with no status field at all. The second reading came from opening the actual file, so
  prefer it, but the parity normaliser task should confirm.

### 7.9 api-documenter fidelity

`api-documenter` was genuinely run against the real 936 KB `index.api.json`. It
fragmented a roughly 13-export package into hundreds of one-member `.md` files and
surfaced about 15 unresolved-`@link` warnings. Usable as a stopgap, poor as a permanent
page design. Keep the roadmap's decision gate for the quality judgement; drop any
"never been run" framing.

### 7.10 Gaps the document set does not cover

Five things a reader would need that no document decides. None blocks the architecture;
all need an owner before the site goes live.

1. **No 404 page is specified.** With OAC against the S3 REST endpoint, a missing object
   returns a raw S3 `AccessDenied` XML body, not a styled page. CloudFront custom error
   responses must remap 403 to 404 and serve a chosen document. Nobody decided whether
   that page is site-wide or per-language, where it lives, or how it is wired up.
2. **No rollback story for a published immutable tag.** The design says tag prefixes get
   long `Cache-Control` and are never rebuilt. It does not say what happens when a
   published tag turns out to be wrong — bad content, a leaked internal note, a broken
   injected script.
3. **No cross-generator smoke test for the injected shell.** The design rests on eight
   structurally different injection points continuing to mount the shared header, footer,
   switcher and dark-mode shim after each upstream tool's version bumps. A DOM-presence
   assertion per language, run in CI, would catch it.
4. **NOTICE files have no home.** Retention obligations are named for doc2go, Dokka,
   swift-docc and swift-docc-render without saying where the text is surfaced. Pick a
   `/third-party-notices/` page and a footer link.
5. **Two IA questions are self-flagged but never closed.** Whether per-port guide prose
   is translatable, and whether `/py/` becomes canonical or a landing page pointing at
   `libtmux.git-pull.com`.

### 7.11 Reading the verification ledger

`21-verification-ledger.md` records the raw pre-synthesis verdicts. Some were later
reframed — its Go item concludes gomarkdoc is the right tool, for a question that was
subsequently re-scoped to doc2go at tier 2. The ledger records evidence, not conclusions;
§1 of this file is the pick.

### 7.12 Shell technology changed after the first draft

The first draft of every document specified Astro **Starlight** as the shell. That was
reversed on 2026-09-02 for the reasons in §1.1. When reading any document in this set:

- "Starlight" as the shell means "our own Astro layouts and components".
- Starlight's first-party i18n is not available to us; §3 is now a chosen URL shape
  rather than a forced one.
- `starlight-versions` is no longer a dependency or a tracked risk. Versioning is one
  build per prefix plus our own `versions.json` and switcher component.
- Starlight's bundled Pagefind is replaced by the ~40-line integration already written
  for `social-embed`.
- `starlight-typedoc` was already ruled out by §2.1 and is doubly irrelevant now.

Nothing else changed. The per-language tooling, the AWS and CDN design, the CI topology,
the licensing analysis and the shell-contract matrix never depended on the shell
framework.

### 7.12a Corrections found while rewriting

The rewrite pass re-checked claims against source and found six errors in the research
corpus. All six were verified independently before being recorded here.

| Claim in the research | Corrected |
|---|---|
| mrdocs is BSL-1.0 | **Apache-2.0 WITH LLVM-exception** — read from `LICENSE.txt` in the clone. Still permissive, so the C++ conclusion is unchanged, but quote the right licence. |
| `libtmux-java` has 5 modules with real sources | **6.** `libtmux-workspace` carries 7 `.java` files under `src/main` and was missed. `libtmux-bom` is correctly excluded — it is a pure BOM POM with no `src/`. |
| javadoc's `-header`, `-footer`, `-top`, `-bottom` are all live | **`-footer` is dead.** `javadoc -help` states "This option is no longer supported and reports a warning". `-bottom` is the working footer mechanism. |
| DocFX supports an `_appTemplate` override | **No such mechanism.** Zero matches across the whole docfx clone; it is stale Sandcastle-era terminology. The real mechanism is the template array / `-t` flag / `docfx template export`. |
| gomarkdoc's last commit was 2024-07-16 | **2023-08-19** (`8b1606a`). The 2024 date is GitHub's `pushed_at` field, not a commit date. This makes the staleness argument stronger, not weaker. |
| DocC bakes the base path into the compiled JS bundle | **Only into each route's `index.html`.** The JS bundle keeps the literal unsubstituted `BASE_URL:"{{BASE_PATH}}/"` token. The conclusion in §2.2 is unchanged — DocC output still cannot be shared across two prefixes — but the mechanism is narrower than stated. |

One further correction, to an argument rather than a fact. The case against a single CI
image holding all eight toolchains was originally built on image size (a claimed 6-10 GB
and 8-15 minutes of setup). Checking GitHub's actual `ubuntu-24.04` runner manifest
(image 20260823.283.1, checked 2026-09-02) shows Python, Go, a JDK with Gradle, the .NET
SDK, Rust via rustup, CMake, vcpkg, Node.js, Kotlin **and Swift 6.3.3** are already
preinstalled; only bun is genuinely absent. The conclusion — per-repo prefix ownership —
still holds, but on **version-pin coupling and sequential build time**, not disk
footprint. `07-ci-topology.md` carries the rebuilt argument.

### 7.13 Dark-mode storage key is unresolved

`social-embed` persists the theme under the `starlight-theme` `localStorage` key, kept
deliberately for backward compatibility with its own earlier deployment. The design-token
work here proposes `libtmux-theme`, and the cross-site dark-mode story assumes one key
across the git-pull.com properties.

Three options, none picked: migrate `social-embed` to a neutral key, have the shared shim
read both, or accept per-site keys and drop the cross-site ambition. Decide before the
shim ships. `localStorage` is scoped per origin, so this only matters for sites sharing a
hostname or for a deliberate cross-site sync.
