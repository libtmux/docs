# Site-wide search

Use **Pagefind** (MIT), built once per language repo against that language's `stable`/`latest`
output and merged client-side across all eight bundles with Pagefind's `mergeIndex`/`mergeFilter`
APIs. The build hook and client component are not new work — both already exist, ported from
`~/work/typescript/social-embed/packages/site`, and together are under 400 lines. What's genuinely
new is per-generator chrome-stripping for the three languages we don't template ourselves, a
merge-cost budget for searching eight bundles at once instead of one, and one honest gap: Swift's
DocC output is not fully searchable without extra cleanup work, described below rather than
glossed over.

## What we already own

Starlight's pitch was "Pagefind with zero config." Looking at what that config actually is
removes the mystique: a build hook that shells out to the Pagefind CLI, plus a client component
that calls the resulting JS module. `social-embed` already owns both, written during its own
Starlight-to-Astro migration (PR #55), and they port largely unchanged.

The build side, `~/work/typescript/social-embed/packages/site/plugins/astro-pagefind-integration.ts`,
is 45 lines total, comments included (abbreviated below):

```ts
export function pagefindIntegration(): AstroIntegration {
  return {
    hooks: {
      "astro:build:done": ({ dir }) => {
        const targetDir = fileURLToPath(dir);
        return new Promise<void>((resolve, reject) => {
          const proc = spawn("npx", ["pagefind", "--site", targetDir], { shell: true });
          proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
          proc.on("error", reject);
        });
      },
    },
    name: "pagefind",
  };
}
```

It hooks Astro's `astro:build:done` event, spawns the Pagefind CLI over the just-built output
directory, and fails the build on a non-zero exit. Its own header comment says plainly: "This
pattern is borrowed from Starlight's Pagefind integration."

The client side, `~/work/typescript/social-embed/packages/site/src/components/search/usePagefindSearch.ts`,
is a React hook behind a `SearchModal` component tree (`SearchInput`, `SearchResults`,
`SearchResultItem`, `SearchEmptyState`). `loadPagefind()` dynamically imports the built runtime —
`${BASE_URL}/pagefind/pagefind.js` — calls its exported `init()`, then `search(query)` and
resolves each hit's `.data()` for excerpt, title and sub-results. Search is debounced (150ms),
abortable via `AbortController`, with a mock-data fallback for tests without a built index.

One correction before porting further: both the build-hook's own header comment and a first read
of the package suggest the client is "the `@pagefind/default-ui` library." It isn't. The package
declares `@pagefind/default-ui` (`^1.5.2`) as a dependency, but nothing under `src/` imports it —
`rg -l "@pagefind/default-ui" src/` returns no matches. The actual UI is hand-rolled React calling
Pagefind's raw JS module (`init`/`search`/`.data()`), not the prebuilt Component UI — more code, but full
control over highlighting, keyboard navigation and Astro View Transitions (`tryAstroNavigate`).
It also matters for merging: `mergeIndex` is a method on that same raw module, so extending it for
eight bundles is calling existing code, not swapping in a web component. Total cost of not having
Starlight: one 45-line integration, one ~280-line hook, and a handful of presentational
components — mostly ported, not written from scratch.

## The field, and why the shortlist is short

| Tool | License | Needs a running server | Lazy-loads the index | Cross-bundle merge | Verdict |
|---|---|---|---|---|---|
| **Pagefind** | MIT | No | Yes — chunked, alphabetical | `mergeIndex`/`mergeFilter`, built for this | **Recommended** |
| Algolia DocSearch | proprietary hosted service | Runs on Algolia's infra | N/A (server-side) | `facetFilters` + `contextualSearch` | Fallback if self-run tooling becomes a burden |
| Orama | Apache-2.0 | No | No — ships the whole index up front | Not built for this | Rejected — wrong loading model at this scale |
| Lunr.js / minisearch | MIT | No | No — one blob per page load | None | Rejected — 2-4MB blob vs Pagefind's <30KB |
| Stork | Apache-2.0 (unverified) | No | Yes | None | Rejected — unmaintained |
| Typesense | GPL-3.0 (self-hosted) | **Yes** | N/A | Native, but moot | Rejected — needs a running process |
| MeiliSearch | MIT (self-hosted) | **Yes** | N/A | Native, but moot | Rejected — needs a running process |

Typesense and MeiliSearch fail on one fact, not a preference: both require a running server —
Docker, a binary, or a hosted tier — and the site ships to S3 behind CloudFront with no compute
tier at all, so standing one up for search alone reintroduces exactly the operational surface a
static site exists to avoid.

Algolia DocSearch is genuinely well built — free for eligible OSS docs, with `facetFilters` and
`contextualSearch` giving turnkey per-version, per-language scoping that would otherwise be
hand-built with `mergeFilter`. It's passed over because it's a hosted crawler re-fetching the
built site on its own schedule rather than reading build output in CI, and it requires the Algolia
logo unless the self-hosted `docsearch-scraper` is run instead — the escape hatch if the Pagefind
build step ever becomes a burden, not a first choice.

Orama and Lunr/minisearch ship the whole index to the browser on first load instead of fetching
only the chunk a query needs — sound for a single small site, wrong here. Pagefind's own docs
quote "usually ~100kB" for a single site's search precisely because it does the opposite; see the
budget below for why that number doesn't carry unmodified to an eight-bundle merge.

## Indexing eight generators, not one Astro build

`social-embed` runs one Pagefind invocation over one Astro build. That covers none of what
libtmux.org needs: independent per-repo builds, chrome exclusion across generators we don't
template, and a real budget for merging eight bundles. None of it exists in the ported code.

### Independent builds, merged in the browser

Each of the eight repos runs its own `pagefind --site <build-dir>` in its own CI job, against
that language's `stable`/`latest` output only. No coordinating job holds all eight builds on disk
at once — that would make every release block on a shared pipeline, exactly the cross-repo
coupling the CI topology (`07-ci-topology.md`) is designed to avoid. The root shell merges the
bundles at query time, one `mergeIndex` call per language beyond the primary bundle it already
loaded via `init()`:

```js
await pagefind.mergeIndex("/py/stable/pagefind/", { mergeFilter: { sdk: "Python" } });
await pagefind.mergeIndex("/rs/stable/pagefind/", { mergeFilter: { sdk: "Rust" } });
```

`mergeFilter` attaches a facet value to a whole bundle at merge time — no generator template
needs to emit a filter attribute per page. Call the facet `sdk` (or `platform`), not
`lang`/`language`: Pagefind reserves that word for the human-locale facet, covered below. Each
call also accepts `baseUrl`, so a bundle can be built at one path and served from another. Merging
same-origin paths like these needs no CORS configuration at all; merging across subdomains would
require an `Access-Control-Allow-Origin` header on every `/pagefind/*` prefix — one more reason
path prefixes on one domain (ledger §1) are the simpler choice for search specifically.

### The size budget for a merged search

Numbers below are measured, not estimated: a real `npx pagefind@1.5.2 --site <dir>` run against
the built Python docs at `~/work/python/libtmux/docs/_build/html` (108 HTML files, 13.2MB raw)
produced 332KB of index chunks (12 files, alphabetically sharded, ~28KB average), 600KB of
per-page fragments (~5.5KB average, fetched lazily only for shown results), and a one-time
runtime — `pagefind.js` (48KB), one WASM engine (72KB), a worker script (44KB) — ~164KB total,
cached site-wide after first load.

For one bundle, a first search costs roughly that 164KB plus one or two matching chunks plus a
handful of fragments — inside Pagefind's own "~100kB" claim. **Merging doesn't shrink this; it
multiplies the chunk-fetch leg by the number of bundles.** The runtime loads once regardless of
merge count, but `search()` calls every merged instance in parallel, each fetching its own chunk.
Extrapolating the Python baseline across eight bundles: ~164KB (runtime, once) + up to ~8×28KB ≈
224KB (chunks, parallel) + a few ×5.5KB (fragments) — call it 400-450KB for a genuine
cross-language first search. That's order-of-magnitude, not a tight bound — rustdoc/Dokka/Javadoc-
style output tends denser per API surface than Sphinx's 108 hand-authored pages, so re-measure
once real non-Python builds exist. Either way it's sub-megabyte and paid once per session — state
it correctly rather than quoting the single-site "~100kB" figure for an eight-bundle merge.

### Excluding generator chrome — and who has to do it

"Without modifying the generators" splits along a line the ledger already draws (§1): five of
eight languages render through a template we own outright; three render through a generator's own
bundled UI we only skin from the outside.

Python and C++ share `sphinx-gp-theme`, our own theme, so its content wrapper can carry
`data-pagefind-body` directly. A real run against the current build confirms a
zero-template-change stopgap already works too: `--root-selector "article#furo-main-content"`
drops the sidebar-nav-and-banner noise otherwise duplicated into every fragment, cutting the
bundle 1.6MB → 1.4MB and, as a side effect, consolidating 50 redirect-alias pages that become
byte-identical to their canonical page once chrome is stripped. TypeScript, .NET and Go render
through our own Astro components (`00-DECISIONS.md` §1), so the question doesn't arise there at
all — we simply don't emit chrome into the indexed region.

That leaves Rust, Java+Kotlin and Swift, generators we skin from outside but don't template.
Pagefind's CLI flags reach these without touching generator source:

| Generator | Chrome to exclude | Fix, no generator change |
|---|---|---|
| rustdoc | `src/**/*.rs.html` source pages dominate word count; sidebar crate tree | `#![doc(html_no_source)]` in the crate root (a source attribute — the one exception touching a file, but a libtmux-owned one) plus `exclude_selectors: ["nav.sidebar"]` |
| Dokka | package/module tree sidebar | `exclude_selectors`; Dokka's `#content` also works as `--root-selector` |
| DocC (Swift) | a harder problem | see the DocC section below |

`exclude_selectors` (CLI `--exclude-selectors`, env `PAGEFIND_EXCLUDE_SELECTORS`) strips matching
elements at index time regardless of what emitted them. Some of this is already free: Pagefind
hard-codes `nav`, `footer`, `script`, `style`, `form`, `svg`, `iframe`, `template` and `noscript`
into its parser's removal list (`~/study/rust/pagefind/pagefind/src/fossick/parser.rs:31-33`) and
strips them by default. `data-pagefind-body`/`data-pagefind-ignore` are the better mechanism
wherever we control the template (Sphinx, our three Astro-rendered languages): once any page
carries `data-pagefind-body`, pages without it are excluded entirely — a free way to drop
generated index/search pages without a separate glob. The CLI's `--glob` has no negation support
(backed by the `wax` crate 0.7.0, `pagefind/Cargo.toml`), so it can't express "everything except
source-view pages" — `exclude_selectors`/`html_no_source` are the real tools for that.

### Filters and locales: what's free, what isn't

The programming-language facet is `mergeFilter`, already covered above — one value per bundle, no
per-page generator work. A cross-version facet is deliberately not built at all: the next section
explains why only one build per language ever enters the merged index, removing the need for it.

Per-locale indexing (human locale, not programming language) is close to free. Pagefind reads
`<html lang>` at index time and builds one chunk set per detected language
automatically, in the same bundle, no separate invocation per locale
(`~/study/rust/pagefind/docs/content/docs/multilingual.md`); in the browser it loads whichever set
matches the current page's own `lang` attribute, with UI strings for roughly fifty languages and
CJK segmentation by default. Since only shell prose is translated (ledger §3 — reference content
carries no locale segment), the shell builds once across its `/ja/` etc. subtrees, indexes once,
and per-`lang` chunking does the rest. One caveat that only bites once translations exist: all
bundles merged via `mergeIndex` share the *primary* instance's WASM engine, so its stemming rules
apply to every merged search — irrelevant while every reference port is English, real once a
translated shell bundle sits alongside the still-English reference bundles.

### Theming against the shared tokens

Pagefind's Component UI (recommended since v1.5.0, though not what `social-embed` actually uses)
themes through `--pf-*` CSS custom properties — `--pf-text`, `--pf-background`, `--pf-border`,
`--pf-mark`, `--pf-border-radius`, `--pf-shadow-{sm,md,lg}` — with dark mode via
`data-pf-theme="dark"` or `prefers-color-scheme`. Since the hand-rolled path we're porting doesn't
consume the Component UI, theming isn't "map onto `--pf-*`" but "style our own
`SearchModal`/`SearchInput`/`SearchResultItem`," which is simpler: they're already Tailwind-classed
React components drawing from the same tokens (`gp-furo-tokens`'s 157 custom properties,
`00-DECISIONS.md` §4) as every other shell component, with no separate bridge stylesheet needed.

## Index `stable`/`latest` only

Index only the build alias the shell links to by default, not the full version history. The
argument is duplication, not effort: API surfaces evolve incrementally, so an old tagged version
is near-identical to the next, and indexing every tag multiplies bundle size roughly N× for
almost no unique content while flooding results with near-duplicate hits — bad UX ("which of
these six identical results is current?"). Each generator already has its own in-page search
scoped to the version a reader is looking at — rustdoc's `search-index.js`, DocFX's own index —
the right tool for "find something in the docs I'm already reading," not a merged cross-version
index. It also sidesteps a version facet entirely: with one build per language in the merge,
there's nothing to disambiguate.

## Swift DocC: resolving crawlability against ledger §2.2

Ledger §2.2 settles a routing question: `StaticHostableTransformer.transform()` writes a real,
distinct `index.html` per route, so no SPA catch-all is needed in the CloudFront Function. That
stands. It's a narrower claim than crawlability, and conflating the two is the mistake to avoid: a
real per-route file isn't the same as a file whose DOM contains indexable prose.

Under the stable `--transform-for-static-hosting` flag, it doesn't. Every route's HTML is
byte-identical — an empty shell that docc-render's Vue bundle hydrates client-side from
`data/documentation/**/*.json`. Pagefind crawls the DOM as served, not after JS runs, so this is a
dead zone: real, distinct files, empty of the words a search should find.

An experimental flag partially changes this: `--experimental-transform-for-static-hosting-with-content`
bakes real rendered HTML — including a real `<title>`/`<meta name="description">` outside the
`<noscript>` wrapper — into each route, with the page prose itself going *inside* that `<noscript>`
element (`~/study/swift/swift-docc/Sources/DocCCommandLine/Action/Actions/Convert/FileWritingHTMLContentConsumer.swift:56-67`
replaces the template's `<noscript>` interior). Pagefind hard-codes `noscript` into the same
removal list as `script`/`nav`/`style`, so by default this real prose is stripped just like an
empty shell — confirmed by an isolated fixture: text placed only inside `<noscript>` was absent
from the indexed fragment.

A workaround exists and was empirically verified: `--root-selector noscript` on the DocC run makes
that content indexable — a test word placed only inside `<noscript>` appeared once `noscript` was
set as the root selector, satisfying "without modifying the generators." But the result is broken:
browsers parse `<noscript>` as raw text (RAWTEXT mode), not nested elements, so the extracted field
carries literal, unstripped tag characters — `<h1>Visible Heading</h1> <p>...</p>` shows up
verbatim as searchable text, angle brackets included, unless cleaned up afterward.

Net resolution: DocC's content is technically reachable through a documented CLI flag, not
fundamentally uncrawlable — "un-crawlable" is too strong. The honest state is "reachable with
broken output, needs an unscoped cleanup step," a real reason to defer Swift from the merged index
in v1 without overstating the blocker. Two paths forward, neither built: strip tags after
`--root-selector noscript` indexing, or use Pagefind's Node API (`index.addCustomRecord()`) to feed
DocC's `data/documentation/**/*.json` symbol data in directly, bypassing `noscript` entirely — the
cleaner fix, since it never depends on RAWTEXT parsing. Until either lands, scope Swift out of
`mergeIndex` and let DocC's own client-side JSON search, which already understands its SPA
routing, serve Swift lookups — a silently empty filter bucket is worse than an honestly absent one.

## Build step, concrete

```console
$ npx pagefind@1.5.2 \
    --site dist/stable \
    --root-selector "article#furo-main-content" \
    --output-path dist/stable/pagefind
```

Run this in each repo's own CI job, after that repo's own doc build, against `stable` (or
`latest` before a language's first stable tag) only — never the versions tree. Pin the Pagefind
version identically across all eight repos: `~/study/rust/pagefind/pagefind_web/src/lib.rs:410-415` embeds a
generator-version check on the merged side, and while the mismatch branch is currently a no-op
(`// TODO: Return this as a warning`, the actual error commented out), its existence signals that
cross-bundle version drift may be enforced later. Apply `exclude_selectors`/`--root-selector` per
generator as in the table above — nothing extra needed on the five languages whose templates are
already ours.
