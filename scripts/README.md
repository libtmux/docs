# Build scripts

How to assemble a complete local copy of libtmux.org, and how the version
manifest it serves is produced.

## Prerequisites

Only Node and pnpm are required. Everything else — `uv`, `bun`, `doxygen`,
`docfx`, `swift` — is optional: each self-hosted port's reference generator
is skipped, not fatal, when its toolchain isn't on `PATH` or isn't fully
usable (see "Reference generator statuses" below).

Two of them need help finding themselves, and the build supplies it rather
than asking you to. `bun` installed through npm leaves a shim whose
postinstall never ran; a working copy in a mise install directory is
preferred over it. `docfx` is a .NET global tool, so it needs `DOTNET_ROOT`
set — mise installs the SDK outside every location the apphost searches, and
without it `docfx` exits with "You must install .NET to run this
application" even though .NET is right there. Both are silent no-ops on a
machine that has neither.

## Full local build

```console
$ ./scripts/build-site.sh
```

This assembles `_site/` at the repo root:

- The Astro shell, built once for shared prose (landing page, concepts,
  guides, examples, parity) at the site root.
- The Astro shell again, once per self-hosted port times version
  (`latest`, `stable` by default), each with `LIBTMUX_DOCS_BASE` and the
  version env vars set to that port+version's own values, output under
  `_site/<port>/<version>/`.
- Each self-hosted port's reference generator, run once per port+version
  and copied to `_site/<port>/<version>/api/` when its toolchain is usable
  and the checkout has the generator's config/entrypoint in place.
- One Pagefind pass over the assembled `_site/` tree, so search spans the
  shell and every generator's output together.

Ecosystem ports (Rust, Go, Java — see `site/src/lib/ports.ts`) get no
version subtree at all: the site links out to their canonical host
(docs.rs, pkg.go.dev, javadoc.io), so there is nothing local to build.

The script ends with a summary table, one row per port+version (a single
row for ecosystem ports, which have no version subtree):

```text
PORT     VERSION  MODE           STATUS     REASON
py       latest   sphinx         built      [Sphinx + sphinx-gp-theme] ...
py       stable   sphinx         built      [Sphinx + sphinx-gp-theme] ...
ts       latest   astro          skipped    [@microsoft/api-extractor JSON] bun not usable: ...
rs       -        ecosystem      n/a        deep-links to docs.rs, no local output
```

### Reference generator statuses

- `built` — the generator produced final HTML, copied into
  `<port>/<version>/api/`. True today for Sphinx (Python, C++) and DocC
  (Swift), which render their own final pages.
- `model-only` — the generator ran and produced an intermediate model
  (TypeScript's `docs/api.md`, .NET's docfx YAML), but nothing is copied:
  the shell has no page route yet that renders that model into HTML at
  `/<port>/<version>/api/`. `site/src/lib/ports.ts`'s `referenceUrl()`
  already promises that URL; closing this gap means either wiring a
  content-collection loader + page route for it, or moving that port to
  `referenceMode: 'ecosystem'`.
- `skipped` — the toolchain isn't usable (absent from `PATH`, or present
  but broken — see below) or the checkout doesn't have the generator's
  config/entrypoint yet. Never aborts the run.
- `failed` — the toolchain is usable and the generator was actually
  invoked, but it exited non-zero. Recorded in the table, logged under
  `_site/.build-logs/<port>-<version>.log`, and makes the script exit 1
  *after* printing the full table — every other port still gets built.

A toolchain is checked by actually running it (`uv --version`, and so on),
not just by resolving it on `PATH`: an installed-but-broken binary (seen in
this sandbox — an npm-shimmed `bun` whose postinstall was skipped) is
treated the same as an absent one, a `skipped` row with the first line of
the error, rather than surfacing as a confusing generator `failed`.

**Side effect worth knowing about:** the TypeScript generator is that
repo's own documented invocation, `bun run docs:api`
(`~/work/libtmux/libtmux-ts`'s `AGENTS.md`: "Run `bun run docs:api` and
commit the result") — it writes `packages/libtmux/docs/api.md` in that
checkout, a tracked file. Running a full build with a working `bun`
toolchain may leave a real diff there; review or discard it as you would
any other generated-file diff.

A broken *shell* build (an actual Astro/content error, not a missing
reference toolchain) aborts the whole run — that's not something this
script tries to work around, since it means the site itself doesn't build,
not that one port's reference is unavailable.

### Options

```console
$ ./scripts/build-site.sh --ports py,ts --versions latest
```

```console
$ ./scripts/build-site.sh --skip-refs
```

```console
$ ./scripts/build-site.sh --skip-pagefind
```

`--ports` limits which self-hosted ports get a shell build and a reference
generation pass (comma-separated slugs from `site/src/lib/ports.ts`).
`--versions` overrides the default `latest,stable`. `--skip-refs` builds
only the shell and search index. `--skip-pagefind` skips the final
indexing pass, useful while iterating on everything before it.

## Checks

Four scripts assert things the build itself cannot notice. None of them needs
an assembled site; all four are fast enough to run before a commit.

```console
$ node scripts/check-citations.mjs
```

Every source path the prose cites must exist in the port it names — the
`file="…"` fences, the `// From <path>` comments, and each page's "Where this
comes from" table. A fence read from a checkout fails the build when its file
disappears; a hand-quoted one does not, and that is the gap this closes. It
does *not* require a hand-quoted excerpt to match its source byte for byte:
several are excerpts with a clarifying comment added, which is what those
tables already say.

```console
$ node scripts/gen-mcp-tools.mjs
```

Regenerates `site/src/data/mcp-tools.json`, the cross-port MCP tool matrix
`/mcp/tools/` renders. Pass `--check` to fail instead of writing when the
checked-in file is stale. It refuses to write a matrix unless its Python rule
reproduces libtmux-mcp's own documented tool set name for name, every port
declaring a wire prefix carries it on every tool, and all eight checkouts are
present — a partial matrix looks exactly like a finding.

```console
$ bash scripts/check-preview.sh
```

Builds the shell the way `deploy-shell.yml` builds a pull request preview
(`LIBTMUX_DOCS_BASE` and `LIBTMUX_DOCS_ROOT` both `/pr-42/`) and fails if any
absolute URL in the output leaves that prefix. A link that escapes is not a
404 a crawler catches — it is a working link to production, clicked with the
preview's own header still on screen.

```console
$ node scripts/audit-site.mjs && node scripts/crawl-site.mjs
```

These two do need an assembled `_site/`: the first flags empty, thin and
admonition-rendering pages, the second follows every internal link from `/`.

## Version manifest

`site/public/versions.json` is a committed seed: two entries per port
(`latest`, `stable`), so the version switcher (see
`site/src/components/VersionSwitcher.astro`) has something to render
before any real deploy has produced a richer manifest. `build-site.sh`
regenerates a fuller one from the checkouts it finds and writes it over the
seed at `_site/versions.json`, so a local assembly shows real tags where a
checkout is present.

To regenerate the manifest by hand, or to check what a fresh derivation
looks like:

```console
$ node scripts/gen-versions.mjs
```

Writing straight to a file instead of stdout:

```console
$ node scripts/gen-versions.mjs --out site/public/versions.json
```

Entries are derived per port from each checkout named in
`site/src/lib/ports.ts` (`~/work/python/libtmux`, and so on): git tags
matching `vX.Y.Z` become `tag` entries, local branches matching `vX.x`
become `branch` entries, the checkout's current `HEAD` is always `latest`
(kind `trunk`), and `stable` is an `alias` resolving to the newest
non-prerelease tag (or to `latest`, if the checkout has no tags yet). A
port whose checkout isn't present on this machine falls back to the same
two-entry seed `--seed` mode produces, with a note on stderr.

To regenerate the committed seed itself (only needed if the manifest shape
in `site/src/lib/versions.ts` changes):

```console
$ node scripts/gen-versions.mjs --seed --out site/public/versions.json
```

`--overrides <path>` merges a partial manifest over the derived one —
entries merge by `slug` within each port, `defaultVersion` keys replace
outright:

```console
$ node scripts/gen-versions.mjs --overrides overrides.json
```

## Known gap: search only works from the site root today

`site/src/pages/search.astro` builds its Pagefind bundle URL from
`import.meta.env.BASE_URL` — correct for the one Pagefind index Starlight
or a single-version site would have, but this site runs Pagefind exactly
once over the whole assembled `_site/` tree (`/pagefind/...`), not once per
port+version. A search page rendered under `_site/<port>/<version>/search/`
computes `/<port>/<version>/pagefind/...`, which doesn't exist — only the
root-level `_site/search/` page's `BASE_URL` of `/` happens to line up.
`SiteHeader.astro`'s search link already points at the root `/search/`
unconditionally, so this doesn't break site navigation today, but the
per-port/version copies of that page are dead weight and would actively
break if anything ever links to them directly. Worth an absolute
`/pagefind/` path in `search.astro` rather than a `BASE_URL`-relative one —
flagged here for whoever owns that file, not fixed here.
