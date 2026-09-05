# Python reference pipeline

Keep Sphinx + `sphinx-gp-theme` exactly as it runs today, template the five hardcoded
absolute paths in `docs/_templates/page.html`, `docs/manifest.json`, and the `conf.py`
announcement banner, and add a CI lane building tag and `stable`/`latest` copies with
`-D html_baseurl=` set per prefix. Sphinx's own navigation links are already
prefix-safe. `sphinx-contrib/multiversion` is real and reproducible, but it is a
one-time backfill tool, not the steady-state build — see the open risk on autodoc
binding below.

## What the ecosystem expects, and what libtmux.org adds

Python users expect API docs built with Sphinx, discoverable from the PyPI project page,
cross-referenceable via a predictable `objects.inv` at the docs root — a 2026 survey
still calls Read the Docs "the default answer for Python and open-source documentation"
for exactly this reason. libtmux already sits outside that norm by self-hosting instead
of readthedocs.io, while keeping the tooling and `objects.inv`/intersphinx contract those
users rely on. libtmux.org keeps that contract and adds three things the current
single-version, single-domain site lacks:

1. **A version-independent alias** — today publishes only `HEAD`, with no
   `/py/v0.46.2/` versus `/py/stable/` distinction to pin against.
2. **Cross-language linking** — Python's `objects.inv` becomes an artifact the other
   seven ports fetch and pass as a local-file `intersphinx_mapping` entry.
3. **A shared visual identity** — `sphinx-gp-theme`'s 157 CSS custom properties (153
   Furo tokens plus 4 gp-sphinx role tokens, both declared in
   `gp-furo-tokens/src/contract.ts`) become the source the other seven generators skin
   against, via a plain-CSS export.

No version switcher comes free. `sphinx-gp-theme`'s sidebar list (`scroll-start`,
`brand`, `search`, `navigation`, `projects`, `scroll-end`) has no switcher partial at
all. Its parent theme `gp-furo` (`theme.conf`: `inherit = gp-furo`) does carry
`rtd-versions.html`/`variant-selector.html` in the inheritance chain, but both are gated
`{% if READTHEDOCS %}` and never render outside actual Read the Docs hosting regardless
of which theme in the chain owns them. The widget must be built once, driven by the
runtime `versions.json` manifest (ledger §6) — the same component the Astro shell
renders for the other seven languages.

## Tool decision: keep Sphinx, use multiversion as a backfill tool

**No change to the renderer.** Sphinx 8.2.3 (gp-sphinx pins `>=8.1,<9`) + Furo, via
`gp_sphinx.config.merge_sphinx_config`, stays the generator — BSD-2-Clause (Sphinx), MIT
(Furo, gp-sphinx). Rejected: **sphinx-autoapi** parses source instead of importing, and
conf.py's two custom autodoc extensions assume live-import, so switching regresses them;
**mkdocstrings/MkDocs Material** discards the whole gp-sphinx design system and 12+
extensions for a tool the 2026 landscape survey ranks below Sphinx on deep
cross-project linking, libtmux's actual position; **pdoc, pydoctor** are zero-config
tools for small projects with no path to the token bridge or intersphinx contract this
site needs.

For multi-version orchestration, `sphinx-contrib/multiversion` and `sphinx-polyversion`
were compared head to head:

| | multiversion | polyversion |
|---|---|---|
| Mechanism | One `confdir_absolute` computed outside the per-ref loop; every `sphinx-build -c confdir_absolute` uses the *current* conf.py/theme/CSS, content from each ref's `git archive`. | Checks out the entire historical tree per ref, reinstalling that ref's own pinned deps into an isolated venv by default. |
| Result | Old content, current design — reproduced: a marker injected only into the uncommitted working-tree `conf.py`/`custom.css` appeared in real builds of tags v0.20.0 and v0.40.0, while each tag's prose matched its own commit. | Old content, period-correct design — the opposite of a uniform-identity goal absent custom driver work. |
| Maintenance | Stale: last substantive commit 2025-11-24, 57 open issues, PyPI release from 2020. | Healthier: PyPI 3.0.0 matches its git tag, 4 open issues, pushed 2026-08-01. |
| Sphinx 9 | **Broken.** `TypeError: Config.read() takes 2 positional arguments but 3 were given` — reproduced against Sphinx 9.1.0 (9.1.1 doesn't exist on PyPI). Fix PR #202, 16 lines, verified working, unmerged 8 months; issue #203 ("still maintained?") unanswered. | N/A. |

`sphinx-contrib/multiversion` is the pick, pinned to commit `cd4c0db` (its last commit to
`main`) rather than the stale PyPI `v0.2.4` or a moving `HEAD`. Reaching its default
behavior with polyversion would mean fighting its per-ref-isolation idiom with custom
driver code. The Sphinx 9 break isn't an immediate blocker — `gp-sphinx`'s `pyproject.
toml` pins `sphinx>=8.1,<9`, and the empirical build ran on installed Sphinx 8.2.3 — but
raising that ceiling and unblocking multiversion are now coupled decisions; vendor
PR #202's diff locally rather than wait for a release.

Three more caveats govern how the tool is used:

- **No switcher UI ships** — only a Jinja context (`versions.branches`, `versions.tags`,
  `vpathto()`) and one example bullet-list partial; the widget is theme work.
- **Refs are silently dropped.** Tag v0.10.0 was excluded from a real `--dump-metadata`
  run because its historical `conf.py` imports `alagitpull`/`sphinx_issues`, neither
  installed today — issue #165, open since 2025-03-17, no response.
- **Wiring is not automatic.** Omitting `sphinx_multiversion` from `extensions` silently
  bakes the *current* version string into every historical page instead of failing.
  `smv_tag_whitelist`/`smv_branch_whitelist` must be set explicitly — unset defaults are
  `^.*$`, which matched all 316 local refs including throwaway branches.

## The verified shell contract

| Contract point | Mechanism |
|---|---|
| Base path | Links are relative by construction — `pathto()` → `relative_uri()`, depth-independent. `html_baseurl` feeds only the canonical `<link>` tag and sitemap, never navigation. |
| Head injection | In production use: `html_css_files=["css/custom.css"]`, `html_js_files` its JS analog — both accept absolute `https://` URLs, how ledger §6's runtime-loaded shared header/footer/switcher enters each build without a rebuild. |
| Header/footer override | In production use: `docs/_templates/page.html` does `{% extends "!page.html" %}`, injecting into `block extrahead` — Sphinx's own "extend the original template" mechanism. |
| Machine-readable output | `-b json` emits per-page `.fjson` fragments, not usable as another generator's input. `objects.inv` is the real surface. `sphinx_gp_llms` is already in gp-sphinx's default extensions, so `llms.txt` needs no new wiring. |
| Native search | Furo/basic theme emits `searchindex.js` via `sidebar/search.html`; Pagefind indexes rendered HTML regardless of generator, so both can run — whether Furo's widget stays visible is a call for `08-search.md`. |
| Template override | `_templates/<name>.html` + `{% extends "!<name>.html" %}` — Sphinx's documented, low-brittleness mechanism, already in production use. |

## The prefix move: what breaks, what doesn't

Sphinx's own links are safe at any nesting depth. Five hand-authored absolute references
are not, and `html_baseurl` is unset in both `conf.py` and gp-sphinx's `config.py` today:

1. `docs/_templates/page.html` — `/manifest.json`, `/_static/favicon.ico`,
   `/_static/img/icons/*` (five sizes), `/_static/img/libtmux.svg`. Fix: route each
   through `pathto('_static/...', 1)`, already used for font preloads in the same file.
2. `docs/manifest.json` — `"Scope"`/`"start_url"` pinned to
   `"https://libtmux.git-pull.com/"` (the PWA spec key is lowercase `scope`; this file's
   capitalized `"Scope"` is likely already inert — unverified). Fix: relative `"./"` for
   both, resolving against the manifest's own URL with no per-build templating.
3. `docs/conf.py`'s `theme_options["announcement"]` hardcodes `href='/migration.html'` —
   a fifth hardcoded reference the research corpus didn't list. Already suspect under
   `dirhtml`, which emits `migration/index.html` served at `/migration/`; whether a
   `rediraffe` redirect covers the mismatch is unverified.

`html_baseurl`, the manifest URLs, and `theme_project_url` (feeding `og:url`) should
derive from one per-build value, e.g. `f"https://libtmux.org/py/{ref}/"`, not three
independent ones.

## Cross-language linking: objects.inv

`objects.inv` is Sphinx inventory v2 — two header lines plus a zlib-compressed body of
`name domain:role priority uri dispname` rows, nothing Python-specific. `sphobjinv`'s
`Inventory` class and `sphobjinv convert {zlib,plain,json}` CLI let any other track
build a compatible file from a flat symbol list. `sphinx.ext.intersphinx` accepts a
local file path, not just a URL, in `intersphinx_mapping`
(`_fetch_inventory_file` in `_load.py` takes that branch whenever the location has no
`://`), so sibling CI consumes Python's `objects.inv` as a downloaded artifact, no
network fetch at build time. Point consumers at
`https://libtmux.org/py/stable/objects.inv` — a released alias, not `/py/latest/`, which
can carry pre-release content. C++'s Breathe bridge shares this contract; see
`18-lang-cxx.md`.

## Design tokens: a plain-CSS export is a small script

`gp-furo-tokens/src/plugin.ts` already contains every selector a plain-CSS emitter needs:
`body` for light defaults, `body[data-theme="dark"]` for the explicit toggle, and
`@media (prefers-color-scheme: dark) body:not([data-theme="light"])` for OS-preference
dark mode. The `body`-not-`:root` scoping is load-bearing: several tokens are aliases
(e.g. `--color-content-foreground: var(--color-foreground-primary)`), and `var()`
substitution is computed at the declaring element, so an alias declared at a different
scope than its dependency freezes wrong when the dependency changes. A roughly 30-line
script iterating `FURO_LIGHT_TOKENS`, `FURO_DARK_TOKENS`, and `GP_SPHINX_ROLE_TOKENS`
into those three blocks produces a `tokens.css` any non-Sphinx generator can `<link>`
directly — MIT licensed; `"private": true` in `package.json` blocks npm publish only,
not reuse. Caveat: `body[data-theme="dark"]` is this theme's toggle convention —
generators keying dark mode off a different element (rustdoc uses `<html>`) need their
own selector wrapper, which is `03-design-token-bridge.md`'s adapter work. The dark-mode
`localStorage` key itself is unresolved per ledger §7.13.

## Build command and CI

Steady-state CI does not run `sphinx-multiversion` on every push. Immutable tag prefixes
are never rebuilt (ledger §6), and the switcher reads the runtime `versions.json`
manifest, not multiversion's Jinja context. Read as inference from ledger §2.3/§6, not a
standing ruling: multiversion is a one-time **backfill** for the existing historical
tags; steady-state is two plain per-build `sphinx-build` runs.

```console
$ cd docs && uv run sphinx-build \
    -b dirhtml \
    -D html_baseurl=https://libtmux.org/py/v0.46.2/ \
    . _build/html
```

The same command with `html_baseurl=https://libtmux.org/py/stable/` produces the separate
`stable` build ledger §2.3 requires — real bytes with their own canonical tag, not a
second sync of the tagged build (identical bytes at two prefixes is duplicate content
with no dedup signal, and it would ship `stable` pages carrying the *tag's* canonical
URL). Output lands at `docs/_build/html/`, synced to `s3://libtmux-docs/py/<ref>/` on a
tag push and `s3://libtmux-docs/py/latest/` on a `master` push — scoped syncs, never
`--delete` at the bucket root as today's `docs.yml` does, which would erase the other
seven language prefixes.

Additions to `libtmux`'s own `docs.yml` (per-repo, ledger §7.7): trigger on
`push: tags: ['v*']` alongside `master`; wrap the deploy step in
`concurrency: {group: docs-deploy, queue: max}` (ledger §7.6, never combined with
`cancel-in-progress: true`); keep the `LIBTMUX_DOCS_BUCKET` secret and `s3://libtmux-docs`
bucket (ledger §7.3); invalidate only `/py/stable/*`, `/py/latest/*`, the manifest, and
the shell (ledger §7.5 — never `/py/*`, immutable prefixes never change); give this
repo's job an exclusive key in the shared `versions.json`. The existing workflow also
purges a Cloudflare zone after invalidation — whether libtmux.org itself sits behind
Cloudflare is unverified.

## Open risks

- **The backfill's autodoc binding is unverified, not just untested.** The "old content,
  current design" claim was checked against prose and CSS markers only. `conf.py` runs
  `import libtmux` before inserting `project_src` into `sys.path`. Under multiversion's
  fixed `-c confdir_absolute`, every historical tag's autodoc pages would bind to the
  *installed*, current `libtmux` package — wiring `sphinx_multiversion` into `extensions`
  corrects the `version`/`release` strings (see the wiring caveat above), but the
  `SPHINX_MULTIVERSION_SOURCEDIR` redirect does not reach autodoc's *content*, since the
  import already happened against the environment's installed package before that
  variable would be consulted. A correct backfill likely needs per-tag dependency
  isolation for the import while still forcing the current confdir for design —
  polyversion's isolation combined with multiversion's trick, not either alone. Needs a
  real per-tag build test before the backfill runs; this is read from source, not run.
- **Sphinx 9 is a scheduled collision.** The `<9` pin defers it, but multiversion crashes
  on 9.1.0 with no released fix; vendoring PR #202 is required before the pin moves.
- **Two hardcoded-URL issues are unverified, not just unfixed**: the manifest's
  capitalized `"Scope"` key possibly already inert, and whether `/migration.html` already
  404s under the current `dirhtml` output shape.
