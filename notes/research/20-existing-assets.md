# What already exists

Three of the four things libtmux.org needs already exist: a shared Sphinx theme running
in production, a full-featured Python docs tree with its own CI, and a working, owned
Astro shell (`~/work/typescript/social-embed/packages/site`) that is the literal starting
point for the new site. What does not exist is the pipeline — versioning, locales, and
eight foreign API models turned into content — because none of these assets were built to
do that job. This document inventories all four, corrected against source where the
research JSON drifted.

## The gp-sphinx monorepo

`~/work/python/gp-sphinx` is a uv (Python) + pnpm (TypeScript) workspace of **20**
packages under `packages/` — confirmed by `ls` plus a manifest check (`pyproject.toml` or
`package.json` in every directory), correcting the research JSON's prose count of "19"
(its own table already lists 20 rows). All Python packages carry `license = { text =
"MIT" }`; the top-level `LICENSE` confirms "MIT License / Copyright (c) 2026 team
git-pull".

| Package | Purpose |
|---|---|
| `gp-sphinx` | Aggregator — `merge_sphinx_config()` collapses ~300 lines of duplicated `conf.py` per repo into ~10 |
| `gp-furo-tokens` | Zod-validated TS token map + Tailwind v4 plugin, harvested from upstream Furo SCSS |
| `gp-furo-theme` | Tailwind-v4 rewrite of the Furo theme, consuming `gp-furo-tokens` |
| `sphinx-vite-builder` | PEP 517 build backend running Vite via pnpm for Sphinx themes with JS-built static assets |
| `sphinx-gp-opengraph` | Drop-in `sphinxext-opengraph` replacement, no matplotlib dependency |
| `sphinx-gp-sitemap` | Drop-in `sphinx-sitemap` replacement, Sphinx 8.1+ |
| `sphinx-gp-llms` | Emits `llms.txt`, `llms-full.txt`, `docs.json`, per-page `.md` twins |
| `sphinx-gp-mermaid` | Build-time Mermaid → inline SVG, light+dark via `body[data-theme]`, no client JS |
| `sphinx-gp-highlighting` | Pygments lexers + inline-literal helpers |
| `sphinx-gp-theme` | **The theme in production today** — Furo child theme (Jinja/Sass), bundles SPA-nav JS |
| `sphinx-ux-autodoc-layout` | Shared `api-*` DOM layout consumed by every `sphinx-autodoc-*` extension |
| `sphinx-ux-badges` | `BadgeNode` + CSS shared across the autodoc-* family |
| `sphinx-autodoc-api-style` | Type/modifier badges for Python-domain autodoc entries |
| `sphinx-autodoc-argparse` | Modern `sphinx-argparse` replacement, Sphinx 8.x/9.x |
| `sphinx-autodoc-pytest-fixtures` | Documents pytest fixtures with scope badges, dependency graphs |
| `sphinx-autodoc-docutils` | Documents directives/roles/transforms as reference entries |
| `sphinx-autodoc-sphinx` | Documents extension-registered objects (config values, builders, domains) |
| `sphinx-autodoc-fastmcp` | Documents FastMCP tools as card-style entries with safety badges |
| `sphinx-autodoc-typehints-gp` | Single-package `sphinx-autodoc-typehints` + `napoleon` replacement, static AST resolution |
| `sphinx-fonts` | Self-hosted Fontsource fonts, downloaded/cached at build time |

### `sphinx-gp-theme` vs `gp-furo-theme` — production vs mostly-built rewrite

Per ledger §4: `sphinx-gp-theme` (Jinja + Sass, a Furo child theme) renders
`libtmux.git-pull.com` today — `gp_sphinx/defaults.py:125` sets `DEFAULT_THEME: str =
"sphinx-gp-theme"`, verified by direct read. `gp-furo-theme` is a Tailwind v4 rewrite;
its README's "Status" section says "Skeleton — only the theme registration hook
(`setup()`) is wired up," which is stale — `src/gp_furo_theme/__init__.py` registers
three real Sphinx event hooks (`html-page-context`, `builder-inited`, `build-finished`)
backed by working `_compute_navigation_tree`, `_fix_canonical_url`, `_asset_hash`, and
`get_pygments_stylesheet` implementations. The theme directory holds 20 Jinja templates
and 18 CSS component files under `web/src/styles/components/`; `pyproject.toml` sets
`build-backend = "sphinx_vite_builder.build"`, so `pnpm exec vite build` runs before
Hatchling packages the wheel. Scope remaining work as "finish templates and QA a
mostly-built theme," not "build from a skeleton."

### The token contract (`gp-furo-tokens`)

`packages/gp-furo-tokens/src/contract.ts` declares two arrays, verified by direct count
(`rg -c '^\s*"--'`): `FURO_TOKEN_NAMES` holds **153** Furo CSS custom-property names,
harvested programmatically from upstream Furo SCSS (`upstream/furo-vars.json` pins the
source commit). `GP_SPHINX_ROLE_NAMES` holds **4** hand-written semantic aliases —
`--gp-sphinx-type-body`, `--gp-sphinx-type-metadata`, `--gp-sphinx-type-code-inline`,
`--gp-sphinx-type-icon-glyph` — kept separate "so the Furo contract test's 'does not
invent CSS custom properties Furo does not declare' assertion still passes." Total: 157.
`roles.ts` holds the role tokens' *values*, not a third name array; `src/light.ts`
supplies a full light-mode value for all 157, `src/dark.ts` a partial override of only
what Furo redefines for dark mode.

`src/plugin.ts` emits these as a Tailwind v4 plugin onto three selectors, deliberately at
`body` and not `:root`: `body {}`, `body[data-theme="dark"] {}`, and `@media
(prefers-color-scheme: dark) { body:not([data-theme="light"]) {} }`. Furo declares at
`body`, and since some tokens are aliases resolved by CSS `var()` at the point of
declaration, an alias at `:root` while its underlying token is overridden at the more
specific `body[data-theme="dark"]` would freeze at its light value forever. Any
non-Sphinx renderer, including the Astro shell, must reproduce this exact contract to
stay visually consistent. `package.json` sets `"private": true`, `exports` pointing at
`./src/*.ts` with no build step — not npm-publishable as-is.

## The libtmux Python docs (`~/work/python/libtmux/docs`)

55 tracked `.md` files (excluding `_build` and `.venv`), correcting the research JSON's
count of 56 and its `internals/` subtotal of 6 (a direct listing gives 5):

| Section | Count | Pages |
|---|---|---|
| Root | 5 | `index`, `quickstart`, `migration`, `history`, `glossary` |
| `topics/` | 16 | `index`, `architecture`, `automation_patterns`, `clients`, `configuration`, `context_managers`, `design-decisions`, `filtering`, `floating_panes`, `format-tokens`, `options_and_hooks`, `pane_interaction`, `public-vs-internal`, `self_location`, `traversal`, `workspace_setup` |
| `project/` | 7 | `index`, `code-style`, `compatibility`, `contributing`, `deprecations`, `public-api`, `releasing` |
| `internals/` | 5 | `index` + 4 under `internals/api/` (`libtmux._internal.{constants,dataclasses,query_list,sparse_array}`) |
| `api/` | 22 | `index` + 11 `libtmux.*` module pages + `api/testing/` (index, `pytest-plugin/{index,fixtures,usage}`, `test-helpers/{index,constants,environment,random,retry,temporary}`) |

Prose quality is already site-grade: `topics/design-decisions.md` and
`topics/public-vs-internal.md` read as finished user-facing explainers, not internal
notes.

`conf.py` confirms libtmux already runs on gp-sphinx: `from gp_sphinx.config import
make_linkcode_resolve, merge_sphinx_config`, with `extra_extensions=
["sphinx_autodoc_api_style", "sphinx_autodoc_pytest_fixtures", "sphinx.ext.todo"]`,
`intersphinx_mapping` for python/pytest, `linkcode_resolve` via `make_linkcode_resolve`,
`light_logo`/`dark_logo` both `img/libtmux.svg`, `html_favicon="_static/favicon.ico"`,
`html_css_files=["css/custom.css"]`, `html_extra_path=["manifest.json"]`,
`rediraffe_redirects="redirects.txt"`, and `exclude_patterns=["_build", "AGENTS.md",
"CLAUDE.md"]` — agent-guidance files kept out of the built site deliberately. Not set:
`html_baseurl`, so (per ledger §2.3) the site emits no canonical tag today.

`redirects.txt` has 57 rediraffe entries, tracking several restructures — `reference/` →
`api/`, a 2026-03 testing-section move, an `api/` → `project/` policy-docs move.

`_templates/` has 3 files: `book.html` (a Leanpub/Amazon promo for a print book, unrelated
to the design system, external image URLs — a keep/drop call for the redesign, not a
templating problem), `page.html` (extends Furo's `!page.html` to inject `sphinx-fonts`'
font-loading assets into `<head>`), and `sidebar/brand.html` (overrides Furo's sidebar
logo block for light/dark logo swap).

The root `justfile` delegates `build-docs`/`watch-docs`/`serve-docs`/`dev-docs`/
`start-docs` into `docs/justfile`, plus `design-docs`, which runs `sphinx-autobuild
-b dirhtml … --watch . -a` — a full rebuild on every static-file change, for iterating on
theme CSS without incremental-build staleness. The inner `docs/justfile` exposes the full
Sphinx builder matrix: `html` (itself `-b dirhtml` into `_build/html` — target name and
builder disagree), `dirhtml`, `singlehtml`, `epub`, `latex`/`latexpdf`, `text`, `man`,
`json`, `linkcheck`, `doctest`, `checkbuild` (`-n -q`, nitpicky), `redirects`
(`rediraffewritediff`), and `gettext` — the i18n catalog extraction relevant to the
shell's translation goal.

### What must be templated before any prefix move

Three places bake in the production domain, not all the same kind of problem:

- **`manifest.json`** hardcodes literal absolute URLs: `"Scope"` and `"start_url"` are
  both `"https://libtmux.git-pull.com/"`, directly in the JSON file.
- **`_templates/page.html`** hardcodes root-absolute *paths* as literals —
  `<link rel="manifest" href="/manifest.json">`, `<link rel="shortcut icon"
  href="/_static/favicon.ico">`, several `/_static/img/...` icon links — resolving
  against the domain root, not a `/py/` prefix. Its OG/Twitter tags separately
  interpolate `{{ theme_project_url }}`, one hop from a hardcoded value: `conf.py` passes
  `docs_url=about["__docs__"]` into `merge_sphinx_config`, and
  `src/libtmux/__about__.py:12` hardcodes `__docs__ = "https://libtmux.git-pull.com"` —
  real, but not typed literally into `page.html`.
- **`conf.py`'s announcement banner** links `/migration.html` root-absolute. Whether that
  resolves under the `dirhtml` builder's actual output path (`migration/index.html`) is
  unverified here, flagged rather than asserted.

All three need auditing and templating against whatever base path the shell assigns
before the Python docs can build to `/py/` instead of the domain root.

## Docs CI (`.github/workflows/docs.yml`)

The workflow triggers on `push: branches: [master]` only — no tag trigger, no
major-version-branch trigger, no PR-preview job. `dorny/paths-filter@v4` gates the run
behind three filters (`root_docs`: `CHANGES`, `README.*`; `docs`: `docs/**`,
`examples/**`; `python_files`: `src/libtmux/**`, `uv.lock`, `pyproject.toml`), so
unrelated pushes are a no-op. The build caches `~/.cache/sphinx-fonts` keyed on
`hashFiles('docs/conf.py')`, then runs `cd docs && just html` — which, as noted above,
invokes the `dirhtml` builder. Deploy uses OIDC (`role-to-assume:
secrets.LIBTMUX_DOCS_ROLE_ARN`, no long-lived keys), then:

```console
$ aws s3 sync docs/_build/html "s3://${LIBTMUX_DOCS_BUCKET}" \
    --delete \
    --follow-symlinks
```

followed by a three-path CloudFront invalidation (`/index.html`, `/objects.inv`,
`/searchindex.js`) and a Cloudflare cache purge.

None of this extends to eight repos unmodified. The sync target is the bucket *root*
with `--delete`: a second repo publishing into the same bucket would delete the first
repo's output — exactly the failure mode ledger §6 calls out; scope `s3 sync --delete`
to the job's own prefix, never the bucket root. The invalidation list is
`dirhtml`-specific and needs per-language, per-version patterns under a shared setup,
and each repository owns its own `LIBTMUX_DOCS_{ROLE_ARN,BUCKET,DISTRIBUTION}` plus
Cloudflare secrets. `docs.yml` is a single-repo, single-prefix template only; reusing it
as-is is the wrong instinct regardless of URL shape.

## Per-port documentation material — publishable vs internal

Every non-Python port mixes finished user documentation with its own development
scaffolding. All seven README quickstarts already read as landing-page-grade prose —
lift-and-reuse content, not a gap to fill — but each embeds repo-relative links
(`packages/libtmux/docs/api.md`, `docs/psmux.md`, `LibTmux.docc`) that assume GitHub as
the rendering context and need rewriting to site-relative URLs before reuse.

| Port | Publishable | Internal / borderline |
|---|---|---|
| Go | `DESIGN.md`, `PARITY.md`, `BENCHMARKS.md` (regenerated by `go -C benchmarks run .`), `CHANGELOG.md`, `SECURITY.md`, `mcp/{TOOLS,PARITY}.md`, per-module `README.md`s | none — most site-ready port |
| Rust | rustdoc via `//!` module docs with runnable doctests; `crates/libtmux/docs/{design,parity,roadmap}.md`, `format-coverage.txt`, `public-api.txt` | top-level `docs/` exists but is **empty**, not absent (corrects the research JSON); `.git/spike/*.md` are untracked scratch, excluded from inventory |
| Java/Kotlin | `docs/guide/*` (10 topics: getting-started, kotlin, scala, mcp, testing, filtering, streaming, options-and-hooks, batching-and-chaining, snapshots-and-handles), `docs/parity/{python-api,test-map}.md`, `docs/benchmarks/operations.md` | `docs/spikes/00`–`27`, `docs/reviews/*`, `docs/plans/*` (dev history); `docs/studies/*` reads as literature review, borderline |
| .NET | `docs/modes/*.md`, `docs/mcp/*`, `docs/psmux.md`, `docs/public-api.md` + `.json`, `docs/quality-bar.md`, `docs/benchmarks/README.md` | `docs/decisions/000N-*.md` are well-written ADRs, process-narrative in voice, better summarized than republished; `docs/{decisions,parity}/evidence/*` are machine-generated audit trails |
| C++ | `docs/{README,api,api-testing,vcpkg-registry}.md` | `docs/design/*.md` (8 files) mostly internal rationale except `parity-gaps.md`, an honest status page worth publishing as-is; `docs/{bakeoffs,evidence,plans}/*`, `docs/decisions/0001-*` internal |
| Swift | DocC catalog `Sources/LibTmux/LibTmux.docc/*.md` (7 topics), built via `swift package preview-documentation` | `Parity/*.json` (5 machine-checked contract files, not prose) feeds `Scripts/parity/*.py`; check `Scripts/parity_report.py` for a human-facing parity page |
| TypeScript | `examples/` (7 subdirectories + README), `packages/libtmux/docs/{api,criteria}.md` | none — see doc-verification machinery below, this port's most developed asset |

A repo-wide constant: `.github/WRITING.md` exists identically-named in Go, Rust, Swift
and TS, but `md5sum` on all four gives four distinct hashes — deliberate variation or
drift, worth a follow-up diff before treating any one as a shared prose-voice source.

## The design system is shared beyond libtmux

`tmuxp`, `vcspull` and `g` all import `merge_sphinx_config` from `gp_sphinx.config` in
their own `docs/conf.py` — confirmed by grep against all three repositories. Anything
built here for the Sphinx-rendered languages should be reusable across that family, not
libtmux-specific: a shared version-switcher partial, a shared `versions.json` schema, a
shared dark-mode contract. `gp-furo-tokens` is a Tailwind v4 plugin and the Astro shell is
a Tailwind v4 site, so both can consume one token source directly rather than through a
compiled-CSS handoff — a simplification a Starlight-based plan would not have had.

## The Astro shell as an existing asset

`~/work/typescript/social-embed/packages/site` is not a reference architecture — it is
the literal codebase being ported, per ledger §1.2. High-level inventory, verified
against source:

- **Layouts** (2): `BaseLayout.astro` (page shell, header/footer/theme/`head`
  injection) and `MarkdownLayout.astro` (3-column docs layout — sidebar, content, ToC,
  mobile panels).
- **Component groups**: `core/` (`CoreHeaderLayout.astro` — the extension point for a
  language switcher), `docs/` (`Sidebar.astro`, already branching on
  `currentPath.startsWith("/lib/")` vs `"/wc/"` — the same shape becomes `/py/` vs
  `/ts/`; `TableOfContents.astro`; `Mobile{NavToggle,Sidebar,ToC}.astro`), `mdx/`
  (`Tabs`, `TabItem`, `Aside`, `Badge`, `LinkButton` — `Tabs` is the "same task in eight
  languages" component), `search/` (`SearchModal`, `usePagefindSearch.ts`, a React
  island over the Pagefind index), and `icons/`. Two groups, `demo/` and
  `lib-playground/`/`playground/`, are social-embed-specific interactive playgrounds with
  no libtmux equivalent — not porting candidates.
- **Plugins** (5, under `plugins/`): `astro-pagefind-integration.ts` (the ~40-line
  Pagefind build hook, reusable verbatim), two Satteri Markdown/hast plugins, a Vite
  plugin for a local CDN, and a Vite plugin merging MDX headings.
- **Content config**: `src/content.config.ts` defines one `docs` collection using
  Astro's `glob()` loader over `src/content/docs/**/*.{md,mdx}` with a `z.looseObject`
  schema (title required; description, sidebar config, ToC toggle, page-specific `head`
  entries and a `skipMarkdownTitle` flag for README imports all optional) — the pattern
  the eight foreign API models extend, not replace.

Stack, confirmed from `package.json`: Astro 7.2.7, Tailwind 4.3.3, `@astrojs/mdx` 7.0.8,
`@astrojs/react` 6.0.4, `astro-expressive-code` 0.44.1, Pagefind 1.5.2, `@fontsource`
local font packages, TypeScript throughout, Biome for lint and format. No documentation
framework anywhere in the dependency tree.

**Be honest about what this proves and what it does not.** `social-embed` is
single-locale and single-version, ingesting no external API model — two hand-authored
packages' worth of MDX. It proves the shell works and is pleasant to extend. It does not
prove the three things that make libtmux.org hard: many versions served side by side, a
locale-prefixed routing layer, or a content-collection loader ingesting foreign
JSON/YAML into typed pages. See `24-astro-shell.md` for the extension design; this
document is the inventory, that one is the plan. One item to carry over: `social-embed`
persists dark-mode preference under the `starlight-theme` `localStorage` key, kept for
backward compatibility with an earlier deployment — ledger §7.13 leaves the cross-site
key question unresolved.

## TypeScript doc-verification scripts (`libtmux-ts/scripts/check-doc-*.ts`)

This port has the most developed doc-truth machinery of any repo in the family. Its
`package.json` names seven gates:

| npm script | Script | Proves |
|---|---|---|
| `docs:comments` | `check-doc-comments.ts` | A doc comment closed (`*/`) immediately followed by another opened (`/**`) documents nothing — TypeScript keeps only the second. One pass found nine drifted comments, including a `@param` stranded on a private field while its constructor parameter went undocumented. |
| `docs:links` | `check-doc-links.ts` | Every relative link and `#anchor` in tracked Markdown resolves, using the generated reference's own `slugify`. External links skip deliberately, to avoid CI flaking on someone else's downtime. |
| `docs:claims` | `check-doc-claims.ts` | Five tree-derived claims — a path named in a shell block exists; a named package is one the workspace publishes; install examples pin prereleases to the manifest version; a tmux-version badge matches what CI tests; every README states its host-platform boundary — built to catch the bug its own comment names: "the root README told readers to clone the repository because npm had nothing on it... through five published releases." |
| `docs:runnable` | `check-doc-runnable.ts` | A `<!-- runs: examples/agent.ts -->` marker requires every line the README shows to appear, in order, in that example file, itself run against a real isolated tmux — proof the recipe works, not just that it compiles. |
| `typecheck:readme` | `check-readme.ts` | Fenced TypeScript spanning more than one package typechecks, each block wrapped standalone. |
| `test:docs` | `check-readme-runs.ts` | Executes those cross-package README snippets against live tmux. |
| *(implicit)* | package build/test | `packages/libtmux`'s own README/API docs are gated by the package's own build step. |

Reusable **as a pattern, not as shared code**: every port already proves its own docs
stay true to its own code, but each invented its own marker dialect — TS
`<!-- runs: FILE -->`; .NET `<!-- snippet: Name usings: X --> … <!-- endsnippet -->`; Go
`<!-- docs:quickstart --> … <!-- docs:end -->`; Java a `docs-tests/` package that
compiles and runs every README/guide snippet against a real tmux. Keep each gate running
in its own repo's CI, where it has the language's compiler and runtime — the four
dialects are a real unification candidate if the site ever wants a cross-language "run
this example" widget.

## Contradictions found against the research JSON

- Package count: JSON prose says 19; its own table lists 20 rows, and `ls` plus a
  manifest check confirms 20 real packages.
- Template count: JSON says 12 ported Jinja templates in `gp-furo-theme`; a direct count
  is 20.
- Python docs page count: JSON says 56 total with `internals/` at 6; a direct `find`
  gives 55, `internals/` at 5 (its `api/` subtotal of 22 is correct, but its prose under
  `test-helpers/` omits `temporary.md`).
- Doc-comment drift count: JSON says "one found"; the script's own comment says "nine
  had drifted that way."
- Rust `docs/`: JSON says "no `docs/` directory exists at all"; the directory exists and
  is empty — a real distinction from "does not exist."
- The task brief's framing that `_templates/page.html` "hardcodes absolute
  https://libtmux.git-pull.com/ URLs" is partly imprecise: the file hardcodes
  root-absolute *paths* as literals, while the domain-absolute URL reaches it only via
  `{{ theme_project_url }}`, resolved through `docs_url=about["__docs__"]` to the literal
  string in `src/libtmux/__about__.py:12`. `manifest.json` does hardcode the literal URL
  directly, as described.
- The research JSON argues twice, in its own recommendation text, that a subdomain
  scheme (`py.libtmux.org`) is favored by today's single-bucket CI pattern and
  "sidesteps this class of problem entirely." Ledger §1 already chose path prefixes on
  one domain; that choice is not reopened here — the CI facts above are things to fix
  under the chosen scheme, not an argument for reconsidering it.
