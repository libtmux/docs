# C++ reference pipeline

Doxygen 1.18.0 (`GENERATE_XML=YES`, `GENERATE_HTML=NO`) piped through Breathe 4.36.0 into
the same Sphinx + `sphinx-gp-theme` pipeline already rendering the Python docs, run in
libtmux-cxx's own CI. Ledger §2.6 already settled licensing: Doxygen (GPL-2.0-only) runs
as a build step and is never distributed, and `GENERATE_HTML=NO` means no Doxygen HTML is
ever published, so the copyleft question is moot by design. Use this today. Switch to
mrdocs only if libtmux-cxx adopts C++20 modules, someone builds an mrdocs-to-Sphinx
bridge, or hand-authoring the constraint prose Breathe silently drops becomes
unacceptable — none of which is true yet.

## The ecosystem convention, and what libtmux.org adds

C++ has no single blessed hosted-docs convention the way Python has Read the Docs or
Rust has docs.rs — self-hosted Doxygen HTML, or a generated tree pushed to GitHub Pages,
is the closest thing to a norm. libtmux-cxx already ships a homegrown alternative:
`tools/docs/api_index.py`, a regex extractor that walks each header's plain `//` comment
blocks and writes one 261 KB `docs/api.md` with per-symbol anchors — functional, with
none of the cross-reference resolution, search, or shared design system the other seven
ports get.

libtmux.org adds three things that convention lacks. A page sharing `sphinx-gp-theme`'s
157 design tokens with the other seven ports — genuinely free here, not a themed copy,
since C++ builds inside the *same* Sphinx pipeline rather than a lookalike of it. Version
pinning (`/cxx/v0.1.0-alpha.6/`, `/cxx/stable/`) instead of one perpetually-overwritten
HEAD build. And cross-language linking: the C++ Sphinx build emits its own `objects.inv`
(Sphinx inventory v2, `cpp:`-domain entries) that the other ports can consume the same
way they already consume Python's, and its `conf.py` can point `intersphinx_mapping` at
`https://libtmux.org/py/stable/objects.inv` for the reverse direction — the same contract
12-lang-python.md describes for Python's inventory.

## Tool decision

Primary: Doxygen XML → Breathe → Sphinx. Alternatives considered and rejected:

**mrdocs** (`cppalliance/mrdocs`, Apache-2.0 WITH LLVM-exception — every source file's
SPDX header says so; it is not BSL-1.0, a correction to an earlier research pass) is a
genuinely strong permissive alternative: Clang-AST-based, very actively developed
(1,700+ commits, commits landing the same day this research ran, latest tag v0.8.0 from
2025-10-30), and in real production use at Boost.URL, Boost.Beast, Boost.OpenMethod,
Boost.Buffers and Boost.Capy. It is not, however, a drop-in swap for the Doxygen half of
the chain: mrdocs' XML and JSON follow its own schema (`mrdocs.rng` / `mrdocs.schema.json`)
with zero reference to Doxygen's `compound.xsd` anywhere in its generator source, so
Breathe cannot consume mrdocs output. Adopting mrdocs means leaving Sphinx, Breathe and
`sphinx-gp-theme` entirely for C++ — re-skinning mrdocs' own Handlebars/HTML with
gp-furo-tokens' CSS, or building a Breathe-equivalent bridge into Sphinx's `cpp` domain
that does not exist today.

**clang-doc** (`llvm-project/clang-tools-extra`, Apache-2.0 WITH LLVM-exception, ships
inside every clang-tools-extra release) has the thinnest customization surface evaluated:
no header/footer injection flag at all, and its own `--asset` flag's source comment reads
"TODO: Rename this, since it only gets custom CSS/JS." LLVM's own live docs page still
calls it "very early development stage," text unchanged since roughly 2018. Not a
foundation for production docs in 2026.

**poxy** (MIT, wrapping Doxygen HTML + m.css) has excellent first-party CSS/JS/header
injection and even a native version-in-navbar switcher, but it is architecturally an
island with no Sphinx integration, and ships its own m.css client-side search that would
need explicit disabling to avoid fighting the site-wide Pagefind crawl.

**Exhale** (BSD-3-Clause, automates Breathe directive generation) is dead: HEAD
`2024-01-20` in `~/study/python/exhale`, last PyPI release `0.3.7` (2024-01-21), last
GitHub push 2024-08-09, 67 open issues. libtmux-cxx's roughly 75 top-level declarations
across its public headers sit inside Exhale's own stated "small to medium" comfort zone,
which softens the staleness risk, but the recommendation is still to hand-write the
directive stubs rather than depend on a two-and-a-half-year-dead automation layer for a
first rollout.

The prerequisite common to the whole Doxygen path: libtmux-cxx has zero Doxygen-tagged
comments today — `rg -l '^\s*///|/\*\*' include/` returns nothing across every header.
Every header's plain `//` prose needs converting to `///`-prefixed comments before
Doxygen captures any of it. `tools/docs/api_index.py` already parses each comment
block's exact boundaries, so a scripted rewrite is plausible rather than purely manual.

## The verified shell contract

Every point below is inherited wholesale from the Python row (12-lang-python.md,
02-shell-contract-matrix.md), because Breathe's output is not a separate rendered format
— it *is* the Sphinx doctree, built from ordinary reST directives Breathe expands from
Doxygen's XML:

| Contract point | Mechanism |
|---|---|
| Base path | Inherited — Sphinx's `pathto()` / `relative_uri()`, depth-independent; a per-build `html_baseurl` feeds only the canonical tag, never navigation. |
| Head injection | Inherited — `html_css_files` / `html_js_files` in the C++ project's own `conf.py`, pointed at the same runtime-loaded shared header/footer/switcher URL ledger §6 requires. |
| Header / footer | Inherited — `_templates/page.html` with `{% extends "!page.html" %}`, a `_templates/` tree scoped to `docs/cxx/sphinx/`. |
| Machine-readable output | N/A in the Breathe direction — Breathe consumes Doxygen's XML, it does not re-emit a model of its own. The build's own `objects.inv` is the real machine-readable surface the other ports consume, as above. |
| Native search | Inherited — Furo's `searchindex.js` ships regardless of intent; Pagefind crawls the rendered HTML the same as every other port. |
| Template override | Inherited — `_templates/<name>.html` + `{% extends "!<name>.html" %}`. |

Doxygen's own head/header/footer flags — `HTML_HEADER`, `HTML_FOOTER`,
`HTML_EXTRA_STYLESHEET` (`~/study/c++/doxygen/src/config.xml:2063,2196,2230`) — are real
and the most complete first-party set of anything evaluated in this matrix, but moot
here: `GENERATE_HTML=NO` means Doxygen never draws a page for them to decorate.

Two C++-specific `conf.py` keys sit on top of the six inherited ones: `breathe_projects
= {"libtmux": "<path-to-xml>"}` and `breathe_default_project = "libtmux"` point Breathe
at Doxygen's XML output, and `primary_domain = "cpp"` lets bare `:cpp:class:` targets
resolve without a domain prefix.

## Build command

The Doxyfile must expand libtmux-cxx's namespace macro or every declaration fails to
parse downstream. `LIBTMUX_NAMESPACE_BEGIN` / `_END`
(`~/work/libtmux/libtmux-cxx/include/libtmux/abi.hpp:22-26`) wraps every public symbol in
`inline namespace v2_cxx20` / `v2_cxx23`, and Doxygen does not expand macros by default:

```
GENERATE_HTML         = NO
GENERATE_XML          = YES
XML_OUTPUT            = xml
INPUT                 = include/libtmux
EXCLUDE               = include/libtmux/testing
ENABLE_PREPROCESSING  = YES
MACRO_EXPANSION       = YES
EXPAND_ONLY_PREDEF    = YES
PREDEFINED            = "LIBTMUX_NAMESPACE_BEGIN=namespace libtmux {" \
                         "LIBTMUX_NAMESPACE_END=}"
```

This deliberately flattens the ABI-revision inline namespace: pages and cross-reference
URLs read `libtmux::Server`, not `libtmux::v2_cxx23::Server`, and the docs describe the
C++23 / `std::expected` build only — the C++20 branch (`LIBTMUX_USE_TL_EXPECTED`,
substituting `tl::expected`) is a distinct ABI variant this pipeline does not separately
document. `EXCLUDE` drops the `testing/` subdirectory, leaving the 27 public headers out
of 31 total.

```console
$ doxygen docs/cxx/Doxyfile
```

```console
$ uv run sphinx-build \
    -b dirhtml \
    -D html_baseurl=https://libtmux.org/cxx/v0.1.0-alpha.6/ \
    docs/cxx/sphinx \
    _build/cxx
```

No CMake configure step, no compiler, no `compile_commands.json` — Doxygen parses
`include/libtmux` directly as text, as the reproduction that verified this chain did. Keep
it that way: the primary path needs one binary and one project's XML output, not a full
C++ toolchain in the docs job. The mrdocs fallback, by contrast, needs
`-DCMAKE_EXPORT_COMPILE_COMMANDS=ON` and a real compiler, since it works from the Clang
AST rather than comment text.

Pin the Doxygen binary explicitly rather than trusting whatever `apt` gives an
`ubuntu-latest` runner: Breathe parses Doxygen's own XML schema, and the chain above was
verified specifically against Doxygen 1.18.0, installed from the official Linux release
tarball because no `apt`/`pip` Doxygen binary was available in the environment that ran
the reproduction.

```console
$ curl \
    -fsSL \
    -o doxygen.tar.gz \
    https://www.doxygen.nl/files/doxygen-1.18.0.linux.bin.tar.gz
```

## Where the output lands

`_build/cxx` is the whole Sphinx build for this repo's docs — guide/index content plus
the Breathe-driven API pages — synced to `s3://libtmux-docs/cxx/v0.1.0-alpha.6/` as one
prefix, mirroring Python's single-build-per-prefix landing (12-lang-python.md) rather
than a separate top-level segment for a different renderer. The Breathe directive stubs
live at `docs/cxx/sphinx/api/*.rst` in the source tree, so Sphinx's own toctree emits
them under `_build/cxx/api/` — matching the `api/` subpath the site-wide sketch shows for
every port (11-information-architecture.md) with no second build or sync step needed.
`stable` and `latest` are separate builds, each with its own `html_baseurl` and canonical
tag, never a second copy of tagged bytes (ledger §2.3).

## CI step

No `docs.yml` exists in libtmux-cxx today — its `.github/workflows/` holds `ci.yml`,
`codeql.yml`, `release.yml` and `scorecard.yml` only. A new one, scoped to this repo
(ledger §7.7):

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
      - run: >-
          curl -fsSL -o doxygen.tar.gz
          https://www.doxygen.nl/files/doxygen-1.18.0.linux.bin.tar.gz
      - run: tar xzf doxygen.tar.gz
      - run: ./doxygen-1.18.0/bin/doxygen docs/cxx/Doxyfile
      - uses: astral-sh/setup-uv@v7
      - run: >-
          uv run --with breathe==4.36.0 sphinx-build -b dirhtml
          -D html_baseurl=https://libtmux.org/cxx/${{ github.ref_name }}/
          docs/cxx/sphinx _build/cxx
      - uses: actions/upload-artifact@v7
        with:
          name: docs-html
          path: _build/cxx
          retention-days: 1

  publish:
    needs: build
    uses: <org>/libtmux-docs/.github/workflows/publish-docs.yml@v1
    with:
      lang: cxx
      prefix: cxx/${{ github.ref_name }}
      artifact: docs-html
      invalidate: /cxx/stable/*
    secrets:
      role-arn: ${{ secrets.LIBTMUX_DOCS_ROLE_ARN }}
      bucket: ${{ secrets.LIBTMUX_DOCS_BUCKET }}
      distribution: ${{ secrets.LIBTMUX_DOCS_DISTRIBUTION }}
```

A tag push calls the reusable workflow a second time with `prefix: cxx/stable` to rebuild
the alias, per ledger §2.3. `aws s3 sync --delete` scopes to the `cxx/` prefix only
(ledger §6); invalidation targets `/cxx/stable/*` and `/cxx/latest/*` only, never
`/cxx/*` (ledger §7.5).

## Open risks

- **The concept and requires-clause drop is reproduced on a stack we don't ship.** The
  reproduction that found Breathe silently omitting concept bodies and requires-clauses
  ran Doxygen 1.18.0 + Breathe 4.36.0 + **Sphinx 9.1.0**; gp-sphinx pins
  `sphinx>=8.1,<9`, so that exact chain has never been run against the Sphinx 8.x this
  project actually ships. Treat the finding as a strong prior, not a settled fact for
  this stack, and confirm it in a spike before committing docs on top of it. If it holds
  on 8.x too — likely, since the gap is in Breathe's renderer, not Sphinx's C++ domain —
  `.. doxygenconcept::` and `.. doxygenfunction::` will render libtmux-cxx's one concept
  (`ReferenceRange`, `cardinality.hpp:45`) and its one requires-clause (`capture_lines`,
  `capture.hpp:29`) with the constraint body silently missing, no build warning
  (breathe-doc/breathe#482 and #907, both open). Budget for hand-authoring that
  constraint prose inside the directive stub regardless of which Sphinx minor is
  running.
- **mrdocs ingesting plain `//` comments via `-fparse-all-comments` is unverified in a
  different way** — a source-level deduction from the absence of any `CommentOptions`
  override or doc-comment-kind filter in `ASTAction.cpp` / `ClangHelpers.cpp`, never run
  end to end because no mrdocs binary was available to test it. Validate on one real
  header before treating it as a free path to skipping comment migration.
- **The macro-expansion `PREDEFINED` line is not optional.** Without it, the raw
  `LIBTMUX_NAMESPACE_BEGIN` token reaches Doxygen's XML `<type>` fields and crashes
  Sphinx's C++ domain parser on essentially every declaration in the codebase.
- **mrdocs is pre-1.0** (v0.8.0) and it is unconfirmed whether its rendered qualified
  names promote symbols out of libtmux-cxx's inline ABI namespace the way the
  hand-written `PREDEFINED` trick does for Doxygen — check real rendered output before
  switching, since it changes every page URL under the site prefix.
