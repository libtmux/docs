# Rust reference pipeline

libtmux.org builds Rust API reference with stock stable `rustdoc`, reskinned through
its own stable CSS/HTML injection flags (`--extend-css`, `--html-in-header`,
`--html-before-content`, `--html-after-content`), synced to `/rs/`. The same flags feed
`libtmux-rs`'s `[package.metadata.docs.rs]` metadata so docs.rs — where Rust users
already look — carries the same chrome. No nightly toolchain, no forked rustdoc, no
rustdoc-JSON renderer: the JSON path is real but nightly-gated and actively churning,
and the one tool giving full design parity for free, sphinxcontrib-rust, is ruled out
on license grounds alone.

## The ecosystem convention, and what libtmux.org adds

Rust developers expect API docs at `docs.rs/<crate>`: every crates.io publish
auto-triggers a docs.rs build, crate READMEs badge-link to it by convention, and
rust-analyzer's "Open Docs" hover defaults to a docs.rs URL, on top of `cargo doc
--open` as the local dev-loop habit. Making libtmux.org the *only* place Rust docs live
would fight both habits for no benefit, so docs.rs stays canonical for a reader
arriving from crates.io, a Rust IDE, or a search engine already trained on that domain.

What libtmux.org's own `/rs/` build adds on top:

- The same header, footer, dark-mode toggle and version switcher every other language
  port carries, loaded at runtime from `https://libtmux.org/_shell/v1/` per the
  standing rule against baking chrome into a build (ledger §6) — a shell fix reaches
  already-published Rust doc versions without touching rustdoc's output.
- A `/rs/vX.Y.Z/`, `/rs/stable/`, `/rs/latest/` prefix taxonomy matching the other
  seven ports, rather than docs.rs's own per-crate-per-version listing.
- A build docs.rs cannot give: docs.rs only rebuilds on a crates.io publish, so a
  `/rs/latest/` build tracking trunk has no docs.rs equivalent.

Both builds run from the identical flag set so the two copies never visibly diverge.

## Tool decision: alternatives considered and rejected

**sphinxcontrib-rust — ruled out on license, not quality.** This is architecturally the
best fit examined: its `sphinx-rustdocgen` binary parses Rust source directly with
`syn` (no `rustc_driver`, never touching rustdoc JSON) and feeds a `RustDomain(Domain)`
registered into the same Sphinx + `sphinx-gp-theme` pipeline that already renders
Python and C++ — full design parity, full cross-reference and search reuse, zero
JSON-churn exposure. It is excluded anyway: the project is GPL-3.0-or-later end to end
(`LICENSE`; `setup.py`'s `license="GPL-3.0-or-later"`), and unlike Doxygen or rustdoc
themselves — arm's-length subprocesses whose output is consumed, never linked — it is
Python code `import`ed directly into the same `sphinx-build` interpreter via
`extensions = [...]` and `def setup(app)`. Under the FSF's own framing of plugins
loaded into one running program, that is a combined work, not mere aggregation — a
materially stronger copyleft argument than the "run a GPL binary" case that clears
Doxygen (ledger §2.6). Rustdoc JSON stabilizing later wouldn't change this: the parser
was never built on JSON.

**A themed rustdoc-JSON renderer — considered, not chosen.** `--output-format=json` is
registered `Stable` in rustdoc's option table, but the `json` *value* is rejected at
runtime on a stable toolchain: `config.rs` calls `dcx.fatal` citing tracking issue
[rust-lang/rust#76578](https://github.com/rust-lang/rust/issues/76578), open with no
stabilization RFC merged. The schema is real and versioned —
`rustdoc-json-types::FORMAT_VERSION` is `61` on today's nightly, matching crates.io's
`rustdoc-types` v0.61.0 exactly — but it moved 57→58→59→60→61, four breaking bumps
between June and July 2026 alone. Real consumers absorb this continuously:
`cargo-semver-checks` depends on `trustfall_rustdoc`'s explicit `v57`/`v60`/`v61`
compatibility features; `cargo-public-api` bundles a dedicated `rustup-toolchain` crate
purely to pin a nightly. Two renderer-shaped attempts that didn't budget for that churn
are stale: `rustdoc-md` is pinned to `rustdoc-types = "0.56"`, untouched since October
2025; `roogle` hasn't been pushed to since August 2024. `RUSTC_BOOTSTRAP=1` does let a
stable toolchain accept `-Zunstable-options` — confirmed working — but it's an
unofficial bootstrap-compiler escape hatch that only unlocks whichever format snapshot
that stable release happens to carry. `rustdoc-types` is also Rust-only, so an Astro
renderer would need a small Rust adapter binary re-emitting simplified JSON, not a
direct `file()` loader. Reskinning stable rustdoc HTML is the low-maintenance choice
here; the JSON path stays an option to revisit, not a plan.

**Result:** stable, unforked `rustdoc`, tier-2 skin injection, mirrored to docs.rs.

## The verified shell contract

Every flag below was checked against `~/study/rust/rust-librustdoc`'s
`src/librustdoc/lib.rs` option table (`opts()`, `Stable`/`Unstable` markers) and
`config.rs`, not `--help` text or changelogs.

| Contract point | Flag | Stability | What it does |
|---|---|---|---|
| Head injection | `--html-in-header <FILE>` | **Stable** | Spliced raw immediately before `</head>` — last in `<head>`, wins the cascade over `rustdoc.css`. `Multi`: passable more than once. |
| CSS overlay | `--extend-css <FILE>` | **Stable** | Extra `<link>` loaded after `rustdoc.css`/`noscript.css`, before `--html-in-header` — a layer on the default theme. Help text warns it "might break if the rustdoc's generated HTML changes." |
| Full alternate theme | `--theme <FILE.css>` / `--default-theme <NAME>` | **Stable** | Registers a full theme in rustdoc's picker. Missing properties only log a build **warning** (`config.rs:766-772`, non-fatal) — partial coverage ships silently degraded; validate with `--check-theme` (Stable). |
| Header/footer | `--html-before-content <FILE>` / `--html-after-content <FILE>` | **Stable** | `before-content` lands right after `<body>`, before rustdoc's topbar; `after-content` right after `</main>`, last before `</body>` — the version-switcher/footer-nav slot. |
| Markdown-only variants | `--markdown-css`, `--markdown-before/after-content` | `--markdown-css` **Stable**; before/after pair **Unstable** | `--markdown-css` is consumed only by `markdown.rs`'s standalone `rustdoc some.md` path (grepped) — irrelevant to `cargo doc`. |
| Asset renaming | `--resource-suffix <PATH>` | **Unstable** | Suffixes generated CSS/JS filenames; unusable on a pinned stable toolchain. |
| Root landing page | `--enable-index-page` / `--index-page` | **Unstable** | Never fires on stable `cargo doc`; `target/doc/` gets only `target/doc/<crate>/index.html`. CI writes its own redirect. |
| Absolute asset paths | `--static-root-path` | **Unstable** | Without it, static-asset paths default to a relative `../` chain by page depth (`root_path()`, `context.rs:212-213`) — why dropping `target/doc/` under any nested prefix works unmodified. |
| Machine-readable output | `--output-format=json` | Flag **Stable**; `json` value **runtime-gated** | Hard-fails via `dcx.fatal` citing #76578 unless `-Zunstable-options` is also passed, which itself needs nightly. |
| Native search | rustdoc's own `search-index.js` | n/a | Self-contained per-crate widget, coexisting with a site-wide Pagefind crawl whose `REMOVE_SELECTORS` already excludes `<nav>`/`<script>`/`<style>` with no extra config. |
| Template override | none | n/a | No `-template` flag anywhere in `lib.rs`/`config.rs` — the 10 page templates are Askama templates compiled into the binary. Structural change needs forking `rust-lang/rust`, rebased every release — rejected like the doc2go fork (§7.2). |
| Canonical tag | none | n/a | `grep -n canonical html/templates/page.html` is empty — rustdoc emits none. Since `/rs/stable/`/`/rs/latest/` are separate builds (§2.3), each needs its own via `--html-in-header`: shared `head.html` plus a build-specific `canonical.html` (`Multi`); docs.rs gets only the shared fragment. |

`--theme`/`--default-theme` were considered as the primary mechanism and set aside: a
full theme entangles with rustdoc's own `rustdoc-theme`/`rustdoc-use-system-theme`
`localStorage` keys and the `data-theme` attribute `storage.js` sets on `:root` — a
second theme-persistence mechanism alongside the shell's own (unresolved, §7.13) — for
a picker entry the site doesn't need. `--extend-css` plus `--html-in-header` stays
layered on the default theme instead.

**`RUSTDOCFLAGS`** is a `cargo`-level environment variable, not something `rustdoc`
parses (zero references in `librustdoc`'s source); `cargo` splits it on whitespace and
appends the pieces to the invocation. docs.rs doesn't read it: it reads
`[package.metadata.docs.rs]` `rustdoc-args` from `Cargo.toml`, serialized into
`--config build.rustdocflags=[...]` instead, since that form handles whitespace
correctly where the env var can mangle a path with a space. Two gotchas: on docs.rs,
injected files resolve against the **unpacked published `.crate` tarball**, not the git
checkout (verify with `cargo package --list`); in CI, `cargo doc --workspace` resolves
them against cargo's cwd, which may not match the published crate root. Scope
`RUSTDOCFLAGS` to the docs step alone — `[build] rustdocflags` in `.cargo/config.toml`
also hits `cargo test --doc`.

## Build command

```console
$ RUSTDOCFLAGS="--extend-css docs/rustdoc/adapter.css \
    --html-in-header docs/rustdoc/head.html \
    --html-in-header docs/rustdoc/canonical.html \
    --html-before-content docs/rustdoc/before.html \
    --html-after-content docs/rustdoc/after.html" \
    cargo doc \
    --workspace \
    --no-deps
```

`adapter.css` is the rustdoc-specific piece: it maps rustdoc's own custom properties
onto the shared `gp-furo-tokens` palette, small and pinned to the `rust-toolchain.toml`
version, per `--extend-css`'s own help-text warning that a theme "might break if the
rustdoc's generated HTML changes." `head.html`, `before.html` and `after.html` carry
only `<link>`/`<script>` tags pointing at fully-qualified `https://libtmux.org/_shell/v1/...`
URLs — never relative — so the same fragments work unmodified both under `/rs/` and on
docs.rs's own domain.

The same flags, minus `canonical.html`, go into `libtmux-rs`'s `Cargo.toml`:

```toml
[package.metadata.docs.rs]
rustdoc-args = [
  "--extend-css", "docs/rustdoc/adapter.css",
  "--html-in-header", "docs/rustdoc/head.html",
  "--html-before-content", "docs/rustdoc/before.html",
  "--html-after-content", "docs/rustdoc/after.html",
]
```

Pre-flight this flag set locally with `cargo docs-rs` (`cargo-docs-rs`, MIT OR
Apache-2.0): docs.rs unconditionally appends `-Z unstable-options` to every build, so
nightly-only flags are live there but not in our pinned-stable CI.

## Where the output lands, and the CI step

`target/doc/` has no root `index.html` (`--enable-index-page` is Unstable), so CI writes
one by hand pointing at the workspace's primary crate, then syncs under the ledger's
`/rs/` prefix (§7.4), scoped to that prefix alone per the standing rule against
bucket-root `--delete` (§6):

```console
$ aws s3 sync target/doc/ \
    s3://libtmux-docs/rs/v1.2.0/api/ \
    --delete
```

`/rs/stable/` and `/rs/latest/` are real, separate builds, not copies of the tag build
— differing only in which `canonical.html` fragment is passed, per §2.3's finding that
even rustdoc's relative links don't avoid duplicate-content canonical tags. Invalidate
only the mutable pointers (`/rs/stable/*`, `/rs/latest/*`), never the whole `/rs/*`
tree (§7.5); tag prefixes get long `Cache-Control` and sync once, never rebuilt.

This runs in `libtmux-rs`'s own CI, on trunk and tag push, per per-repo prefix
ownership (§7.7) — not a shared monorepo job. It needs
`concurrency: {group: docs-rs, queue: max}` for deploy serialization (§7.6, cannot
combine with `cancel-in-progress`), its own exclusive `manifest/rs.json` key, and the
repo's existing `rust-toolchain.toml` pin. A DOM-presence smoke test confirming the
injected header/footer mounted (§7.10 item 3) belongs in this job — exactly the silent
breakage `--extend-css`'s own warning can't catch.

## Open risks

- **Workspace version ambiguity.** `libtmux-rs` is a multi-crate workspace; which
  crate's version names `/rs/vX.Y.Z/` is not decided here.
- **Custom-property count is disputed** (ledger §7.8): 128 from a real `cargo doc`
  build on rustc 1.98.0, versus 105 from grepping the shipped CSS, unreconciled — don't
  size the adapter to either without re-measuring against the pinned toolchain.
- **Toolchain skew between docs.rs and our pinned CI.** docs.rs builds on whatever
  nightly it runs internally; ours is pinned stable, so an adapter tuned to one rustdoc
  version can drift silently from the other, since a partial `--theme` only warns.
- **`--html-before-content` lands ahead of rustdoc's fixed sidebar/topbar**, not inside
  them — whether the shared header visually collides is unverified until spiked.
- **docs.rs nests our chrome, not the reverse:** it layers its own topbar around the
  stored rustdoc HTML via `lol_html`, so our nav sits inside docs.rs's shell there,
  while ours is the only shell on `/rs/`. A docs.rs canonical link back to `/rs/` is an
  open SEO call.
- **Font notices.** rustdoc vendors OFL-1.1 fonts (Fira, Source Code Pro, Source
  Serif 4, NanumBarunGothic) into `static.files/`; their license files need a home
  under the third-party-notices page the ledger flags as unresolved (§7.10 item 4).
