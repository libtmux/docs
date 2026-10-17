# Build scripts

How to assemble a complete local copy of libtmux.org, and how the version
manifest it serves is produced.

## Prerequisites

Use the Node and pnpm versions declared in `package.json`. Integrated guide
staging also needs the source checkouts named in `site/src/lib/ports.ts` at
its recorded revisions. See [CONTRIBUTING.md](../CONTRIBUTING.md) for setup
and verification loops.

A full local assembly can run native reference generators when their
runtime and checkout are present. Missing optional generators produce
`skipped` rows. Selected-source MCP export is required even with
`--skip-refs`; a failed exporter fails that build.

## Full local build

```console
$ pnpm build:site
```

The default output is `_site/`. Each locale has its own tree, such as
`_site/en/`, containing shared prose and a version subtree for each selected
port. Rust, Go and Java have local guides and references as well as links to
their ecosystem documentation hosts.

`LIBTMUX_DOCS_OUT_DIR` changes the assembly directory. The build replaces
that directory, so select a dedicated generated-output location. The
assembly lock covers the checkout because Astro staging is shared across
builds, including builds with different output directories.

Shell builds use a content-addressed `.build-cache/`. `--no-cache` rebuilds
the shells; `LIBTMUX_DOCS_CACHE` selects a separate cache directory. Native
reference output is cached with its source revision and logs. Cache entries
older than fourteen days are removed during an assembly.

### Reference generator statuses

The final table reports each port and version's reference result:

- `built`: a native reference was generated and assembled.
- `redirected`: the legacy `api/` entry points at the shell's `reference/`.
- `skipped`: the native generator or its input is unavailable, or the run
  selected `--skip-refs`. This does not establish reference coverage.
- `failed`: the generator failed; inspect the named `.build-logs/` file.
- `not listed`: the selected version is absent from the port manifest.

A shell compilation failure aborts the assembly. Check the summary and run
checks against the assembled output before publishing it.

### Clean generated builds

Stop development and preview servers, then list generated output:

```console
$ pnpm run clean --dry-run --cache
```

Remove the listed output and reusable build cache:

```console
$ pnpm run clean --cache
```

Cleanup removes `_site/`, `_site.*/`, `site/dist/`, `site/.astro/` and
transient API and guide staging. Without `--cache`, `.build-cache/` stays.
The assembly lock prevents cleaning a running assembly. Source,
`node_modules/` and `output/` review evidence stay intact. Custom output
and cache directories require explicit cleanup at their own locations.

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

`--ports` limits which ports get a shell build and a reference
generation pass (comma-separated slugs from `site/src/lib/ports.ts`).
`--versions` overrides the default `latest,stable`. `--skip-refs` builds
only the shell and search index. `--skip-pagefind` skips the final
indexing pass, useful while iterating on everything before it.

Port CI binds any named tree to one source checkout. All identity inputs are
required together; branches, PRs, tags, and aliases are refused without them:

```console
$ LIBTMUX_DOCS_PORT=ruby \
    LIBTMUX_DOCS_VERSION=pr-42 \
    LIBTMUX_DOCS_VERSION_KIND=pr \
    LIBTMUX_DOCS_SOURCE_REF=0123456789abcdef0123456789abcdef01234567 \
    LIBTMUX_DOCS_SOURCE_SHA=0123456789abcdef0123456789abcdef01234567 \
    LIBTMUX_DOCS_IS_DEFAULT=false \
    LIBTMUX_DOCS_CHECKOUT_RUBY=/workspace/source \
    ./scripts/build-site.sh \
    --ports ruby \
    --versions pr-42 \
    --skip-refs \
    --skip-pagefind
```

An alias also sets `LIBTMUX_DOCS_RESOLVES_TO` to the immutable tag it names.
The preflight verifies the ref, SHA, checkout HEAD, native export, API model,
staged guides, examples, manifest identity, canonical URLs, and robots policy
before producing the version subtree.

## Checks

### Versioned tmux manual

The command reference uses the revisions in `site/src/data/tmux/versions.json`.
Each snapshot combines that revision's manual with the corresponding binary's
`list-commands` output. The generator starts and cleans up a private server.
It also retains the upstream license and command source locations.
The original `revision` pin is retained separately from its peeled
`sourceCommit` and `sourceTree`. File links use the commit because GitHub's
file endpoints do not accept annotated tag object hashes.

With mandoc 1.14.6 and binaries installed as `<binaries>/<version>/bin/tmux`,
regenerate the committed snapshots:

```console
$ node scripts/gen-tmux-manual.mjs --source ~/study/c/tmux \
    --binaries ~/.local/share/libtmux-tmux-matrix --mandoc mandoc
```

Verify that the snapshots match both the pinned source and installed binaries:

```console
$ node scripts/gen-tmux-manual.mjs --source ~/study/c/tmux \
    --binaries ~/.local/share/libtmux-tmux-matrix --mandoc mandoc --check
```

The formatter's build date and host labels are excluded. Command syntax,
descriptions, manual anchors and the source hashes remain version-specific.

### Site checks

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
declaring a wire prefix carries it on every tool, and every configured MCP
checkout is present — a partial matrix looks exactly like a finding. Ports
whose product status is unpublished, such as Lua, are excluded explicitly.

```console
$ node scripts/gen-registry.mjs
```

Regenerates `site/src/data/registry.json`, which records what each port's
package registry carries right now: a stable release, a prerelease only, or
nothing at all. `installCommand` in
[ports.ts](../site/src/lib/ports.ts) composes that with the install spellings
to produce the command a page or an agent prompt shows, so the command cannot
name a version the registry does not have.

It matters because most ports have no stable release, and several
resolve nothing unless the prerelease is named: Cargo treats an alpha as out of
range for a plain requirement, `go get` without a version resolves the highest
release and a prerelease is not one, and SwiftPM's `from:` excludes prereleases
from its range.

The published site does not read the committed file. `deploy-shell.yml`
resolves the registry against the live registries on every deploy, including
a scheduled one four times an hour, and publishes the result as `/registry.json`; a
release therefore reaches the site without a commit here. The committed file
is what pull requests, local builds and tests use, so their results never
depend on another repository publishing, and nothing requires refreshing it.

Pass `--check` to fail instead of writing when a file differs from what the
script would write. Pass `--offline` to re-emit the baseline without contacting
any registry, for a job that must not depend on ten third-party services; the
test gate runs `--check --offline`. Pass `--baseline <file>` to fall back on a
file other than the committed one, as the deploy does with the copy it last
published. A probe that fails for one port keeps that port's baseline entry
rather than reporting it unpublished, the same way `gen-versions.mjs` falls
back to its seed.

A tag is recorded only once the registry carries its version. A port tags
first and publishes minutes later, and a tag with no package behind it would
send an install command to nothing.

Release tags are read per port. Rust is a Cargo workspace and tags each crate
(`libtmux@v0.1.0-alpha.10`); Go is multi-module and tags submodules under a
path (`mcp/v0.0.1-alpha.9`) while the library tags bare. `tagPrefix` in
ports.ts declares the first case, and its absence rejects any tag carrying `/`
or `@`, so a submodule's release is never read as the library's.

Assemble a complete preview:

```console
$ LIBTMUX_DOCS_LOCALES_ROOT=/pr-42 \
    LIBTMUX_DOCS_VERSION=pr-42 \
    LIBTMUX_DOCS_VERSION_KIND=pr \
    pnpm build:site --versions latest
```

Audit the assembled preview before publishing:

```console
$ bash scripts/check-preview.sh _site pr-42
```

Checks the actual preview artifact for URLs escaping its prefix and internal
links whose pages or fragments are missing. The deployment workflow runs this
audit before uploading the complete preview, including its port/version trees.

```console
$ node scripts/audit-site.mjs && node scripts/crawl-site.mjs
```

These two do need an assembled `_site/`: the first flags empty, thin and
admonition-rendering pages, the second follows every internal link from `/`.

## Version manifest

`site/public/versions.json` is a committed seed with a `latest` trunk entry
per port, so the version switcher (see
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
matching that port's grammar become `tag` entries, local branches matching `vX.x`
become `branch` entries, the checkout's current `HEAD` is always `latest`
(kind `trunk`), and `stable` is an `alias` resolving to the newest
non-prerelease tag. A prerelease-only port gets `next`; it does not get a
fabricated `stable`. RubyGems and LuaRocks release spellings keep their native
forms. A port whose checkout is absent falls back to the same latest-only seed
that `--seed` produces, with a note on stderr. Set
`LIBTMUX_DOCS_CHECKOUT_<PORT>` to derive refs from an exact CI checkout.

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

## Search index

The assembly runs Pagefind over the locale tree after shell and native
pages are assembled. `--skip-pagefind` omits that pass. Development and
partial builds can have no index; the search panel reports the missing
index instead of implying that the current page contains no matches.

The search bundle uses the locale root, including a PR preview's prefix,
so port and version pages share the assembled index.
