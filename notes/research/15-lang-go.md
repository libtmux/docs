# Go reference pipeline

Use doc2go in `-embed` mode, wrapped by a thin Astro content-collection loader — not a
fork of doc2go's templates, and not gomarkdoc. `-embed` emits body-only HTML fragments
with zero chrome of its own, which is exactly what a hand-written Astro page component
wants to wrap. The accepted cost: doc2go hard-errors if `-embed` and `-pagefind` are
both set, so Go gives up doc2go-native search and rides the site-wide Pagefind crawl
like every other port.

## The ecosystem convention, and what libtmux.org adds

Go has a real `docs.rs` equivalent: pkg.go.dev auto-builds and serves API docs for any
tagged, public module, wired into `go doc`/`go get` with no publish step at all. It is,
however, a live server, not a generator — `golang/pkgsite`'s `cmd/` tree is `frontend`,
`worker`, `prober`, nothing that exports a static tree, and the tracking issue for
static export, golang/go#2381, is still open. pkg.go.dev cannot be self-hosted; it can
only be linked to.

libtmux.org adds what that convention structurally cannot: a page sharing the same
`sphinx-gp-theme`-derived design tokens as the other seven ports, at `libtmux.org/go/`,
with real version pinning (`/go/v0.x.y/`, `/go/stable/`) and one Pagefind index searched
across all eight languages at once. It does not replace pkg.go.dev — doc2go's own
`-pkg-doc` link template defaults to it for third-party symbols, and that outbound link
stays visible on the landing page. Fighting a convention this strong (`go get` already
points there) has a real adoption cost for no benefit; libtmux.org/go is a companion.

## Tool decision

### doc2go, not a template fork

doc2go's own HTML templates are baked into a `//go:embed tmpl/*.html` filesystem
(`internal/html/render.go:29-63` in `~/study/golang/doc2go`) with no `-template` flag and
no `os.Open`/`DirFS` anywhere in the package — the only way to change the standalone
page markup is to fork `internal/html/tmpl`. A fork needs rebasing on every doc2go
release, which is exactly the standing maintenance cost this whole architecture exists
to avoid: eight ports, one maintainer, no framework to inherit upgrades from.

`-embed` sidesteps the fork question rather than answering it. In embedded mode
`Renderer.templateName()` returns `"Body"` instead of `"Page"`
(`internal/html/render.go:104-111`), so doc2go emits *only* the documentation body —
confirmed by generating a fragment that opens directly at `<h2 id="pkg-overview">` with
no `<html>`/`<head>`/`<body>` wrapper at all. There is nothing left to skin, because
doc2go never draws the chrome; the embedding Astro page supplies 100% of `<head>`,
navigation, and footer. That fits an owned Astro shell better than it would have fit a
Starlight shell: a fragment is precisely what a hand-written `.astro` page component
wants to receive and wrap, no adapter step in between.

The accepted cost is explicit in source: `flags.go:187-191` hard-errors if `-embed` and
`-pagefind` are both set (`if p.Embed && p.Pagefind.Mode == pagefindEnabled { ...
return nil, errtrace.Wrap(errInvalidArguments) }`), so Go loses doc2go's own Pagefind
integration and rides the site-wide crawl over rendered HTML instead. That crawl
already has to cover the other seven ports, so this is a zero-marginal-cost fallback,
not a gap.

### Alternatives considered and rejected

**gomarkdoc (MIT)** was the earlier recommendation for a Sphinx-shaped design, and the
stand-alone verification ledger still calls it correct *for that question*. That
question no longer applies: gomarkdoc's whole advantage was Markdown entering Sphinx's
own doctree "for free," gaining in-page TOC and search construction as an ordinary
Sphinx source file. Under an owned Astro shell there is no doctree to gain — an HTML
fragment and a Markdown file both need a loader we write either way, so the tier1/tier2
gap that favored gomarkdoc for Sphinx narrows to a wash here. With that factor removed,
maintenance state settles it: gomarkdoc's last commit is `8b1606a`, 2023-08-19, last
tagged release v1.1.0, 2023-06-17 — three PRs (a Go 1.24 bump, a deprecated-anchor fix,
a Unicode fix) sit unmerged since. doc2go's most recent real fix commit is 2026-05-26,
tagged v0.12.2 on 2026-05-17 — current, not merely more recently pushed to. One
smoke-tested edge confirms a robustness gap, not just cadence: doc2go logs and skips a
test-only directory, while gomarkdoc hard-errors on it unless added to `--exclude-dirs`.

**A doc2go template fork** is strictly worse than gomarkdoc would have been on
maintenance cost, since a fork must track doc2go's own release cadence directly rather
than picking up fixes as ordinary upstream Markdown improvements would.

**pkgsite** was never a contender for self-hosting — a server, not a generator, per the
previous section — and stays in scope only as the design reference for what Go
developers already expect a package page to look like.

## The verified shell contract

| Contract point | doc2go `-embed` |
|---|---|
| Base path | Free, no flag needed. Every link routes through `relative.Path()`/`relative.Filepath()` (`internal/relative/relative.go:25,39`), doing src/dst common-prefix removal and emitting `../`-chain hrefs — verified: a `tmux` package linking to sibling `tmuxq` rendered `../`, never `/tmux`. Placeable under any nested prefix with zero regeneration. |
| Head injection | N/A by design — `-embed` emits no `<head>` (`templateName()` returns `"Body"`, `render.go:104-111`). `BaseLayout.astro` supplies the shared `<head>` directly; no injection point is needed. |
| Header / footer | N/A, same reason — zero chrome in `-embed` mode, confirmed by a fragment starting directly at content. The two `{{block}}` hooks in standalone mode (`PkgVersion`, `NavbarExtra`, `tmpl/layout.html:26-30`) are baked into the same `embed.FS`, reachable only by forking. |
| Machine-readable output | None — `encoding/json` appears nowhere in the non-test source tree. The `llms.txt` Markdown twin does not derive from this fragment; per `10-llms-and-agents.md` it comes from a separate extraction over doc2go's parsed AST and resolved doc comments, the same input `-embed` renders from. |
| Native search | Disallowed with `-embed` (`flags.go:187-191`, above). Rides the site-wide Pagefind crawl over rendered HTML instead — zero marginal cost, shared with every port. |
| Template override | None via disk. `render.go:29-63` builds all five page templates from a `//go:embed tmpl/*.html` filesystem; no `-template` flag, no `os.Open`/`DirFS` call. |

One risk the design corpus flagged and the adversarial verification pass then refuted:
matching doc2go's highlighting colors to `sphinx-gp-theme`'s Pygments styles was called
a dead end, "no free color match by name." That's wrong for the classes that matter —
doc2go's Chroma highlighter and gp-sphinx's `GpSphinxLightStyle`/`GpSphinxDarkStyle` use
the identical short-code CSS class taxonomy by construction (a Go snippet run through
both emitted the same `k`/`kd`/`kn`/`kt`/`s`/`mi`/`p`/`nx`/`o`/`w` classes). Reusing the
org's existing token CSS needs only a `.chroma` alias alongside `.highlight`, not a
second theme — and `-highlight classes:` (classes only, no inline colors), not
`-highlight-print-css`.

The static-asset trap recorded elsewhere in this doc set — doc2go's `-subdir` sharing
one `OUTDIR/_/` directory across every published version, so a binary bump silently
restyles older versions — does not apply here. `WriteStatic()` is a no-op in embedded
mode (`render.go:112-115`), so `-subdir` and its shared-assets trap are standalone-mode
concerns only. Go's versioning is Astro `base` per build, one build per version prefix,
same as every other Astro-rendered port (ledger §2.3, §7.12) — no separate doc2go
versioning mechanism to reconcile.

## The build command

```console
$ go install go.abhg.dev/doc2go@v0.12.2
```

```console
$ doc2go \
    -embed \
    -home github.com/libtmux/libtmux-go \
    -basename index.html \
    -rel-link-style directory \
    -highlight classes: \
    -out etl/go \
    ./tmux/... \
    ./tmuxq/... \
    ./mcp/... \
    ./workspace/...
```

Every package pattern is listed explicitly, not `./...`: `libtmux-go`'s `go.work`
declares five members (root, `benchmarks`, `examples`, `mcp`, `workspace`), and whether
a bare `./...` auto-expands across members the way `go build` does is unverified for
doc2go. `tmux`/`tmuxq` are root-module packages; `mcp`/`workspace` ship their own public
API and belong in the reference; `benchmarks`/`examples` are excluded as not importable.

`-basename index.html`, not the `index.md` Hugo/Jekyll embedding uses, since the loader
reads raw HTML directly and a `.md` name invites downstream Markdown parsing.
`-rel-link-style directory` renders relative links with a trailing slash (`foo/bar/`,
not `foo/bar` or `foo/bar/index.html`, `flags.go:343-358`), matching the shell's own
directory-style URLs so doc2go's hrefs resolve once re-hosted under an Astro route.

## Where the output lands

`etl/go/` is not itself an Astro content collection source in the `file()` sense —
doc2go's fragments have no flat JSON/YAML shape to walk. Per `24-astro-shell.md`, the
loader is a thin wrapper: read each fragment file, call `store.set()` with the raw HTML
in `rendered.html` so `render(entry)` in an `[...slug].astro` page returns a working
`<Content />`. Two things push it past "thin": the loader has to walk `<h2 id>`/`<h3
id>` headings out of each fragment into `rendered.metadata.headings`, or the shell's
shared `TableOfContents.astro` has nothing to render, since doc2go's own in-page nav is
part of the chrome `-embed` omits; and the sidebar's package tree has to be derived from
`etl/go/`'s own directory layout, since doc2go emits no manifest of what packages exist.

The resulting pages land under `s3://libtmux-docs/go/<version>/api/` (bucket and prefix
per ledger §7.3/§7.4), mirrored to `/go/stable/api/` and `/go/latest/api/` as separate
builds per ledger §2.3 — each build sets Astro's `base` to its own prefix, never one
build served at two paths. `--delete` in the sync step is scoped to `go/` only (§6).

## CI step

`libtmux-go`'s `.github/workflows/` holds only `tests.yml` today; a new `docs.yml`
follows the caller/reusable-workflow split from `07-ci-topology.md` — a satellite
Node/bun toolchain runs the Astro build alongside Go's own, in this repo's own CI,
never folded into a shared job (ledger §7.7):

```yaml
name: docs

on:
  push:
    tags: ["v*"]

concurrency:
  group: docs-deploy
  queue: max

permissions:
  contents: read
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-go@v6
        with:
          go-version: "1.26.5"
      - run: go install go.abhg.dev/doc2go@v0.12.2
      - run: >-
          doc2go -embed -home github.com/libtmux/libtmux-go
          -basename index.html -rel-link-style directory
          -highlight classes: -out etl/go
          ./tmux/... ./tmuxq/... ./mcp/... ./workspace/...
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run astro build --site https://libtmux.org --base /go/${{ github.ref_name }}/
      - uses: actions/upload-artifact@v7
        with:
          name: docs-html
          path: dist
          retention-days: 1

  publish:
    needs: build
    uses: <org>/libtmux-docs/.github/workflows/publish-docs.yml@v1
    with:
      lang: go
      prefix: go/${{ github.ref_name }}
      artifact: docs-html
      invalidate: /go/stable/*
    secrets:
      role-arn: ${{ secrets.LIBTMUX_DOCS_ROLE_ARN }}
      bucket: ${{ secrets.LIBTMUX_DOCS_BUCKET }}
      distribution: ${{ secrets.LIBTMUX_DOCS_DISTRIBUTION }}
```

A tag push calls the reusable workflow a second time with `prefix: go/stable` to
rebuild the alias (§2.3 — real, separate bytes, not a redirect). Root tags today are
`v0.0.1-alpha.1`-shaped; `mcp/`, `workspace/`, `benchmarks/`, and `examples/` each tag
independently, which the docs build ignores since it always builds against the root
module's tag.

doc2go's `LICENSE` is Apache-2.0 with no accompanying `NOTICE` file in the repo (no
`NOTICE*` at the repository root). Apache-2.0 still requires retaining the license text
on redistribution; point it at the `/third-party-notices/` page ledger §7.10.4 already
calls for, rather than deciding this per-language.

## Open risks

- **Workspace expansion is unverified.** Whether doc2go's package loader auto-discovers
  `go.work` members from a single root pattern (the way `go build ./...` does) or needs
  every member's pattern listed explicitly, as done above, was not tested against
  `libtmux-go`'s actual five-member workspace before this document was written — verify
  before dropping the explicit pattern list.
- **The loader and heading extraction do not exist yet.** Unlike a JSON-model port,
  there is no schema to validate against — the loader's correctness rests on doc2go's
  HTML shape staying stable release to release, which is not a contract doc2go makes
  explicitly.
- **doc2go version pinning matters even under `-embed`.** `WriteStatic()` being a no-op
  removes the shared-`_/`-directory trap, but the fragment's own internal markup
  (heading ids, Chroma class names) is still whatever that pinned doc2go release emits;
  an unpinned `go install ...@latest` in CI could silently change the shape the loader
  parses.
- **gomarkdoc revisit trigger.** None credible — unlike TypeDoc's TS7 gap, gomarkdoc's
  three open PRs are unmerged with no maintainer response, and its architecture problem
  (Sphinx-doctree advantage) is moot outside a Sphinx-shaped shell regardless. Treat this
  choice as stable, not pending an upstream fix.
- **Pagefind coverage of `-embed` fragments is one layer indirect.** The crawl indexes
  the final rendered Astro page, not doc2go's fragment directly — confirm the shared
  `data-pagefind-body` wrapper the Astro template applies actually encloses the injected
  fragment before relying on Go pages showing up in search results.
