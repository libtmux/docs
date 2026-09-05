# `/_shell/` — the design-token bridge

This file lives under `site/public/`, so Astro publishes it verbatim to
`libtmux.org/_shell/README.md` on every build — the same passthrough that
publishes `tokens.css` and `shell.js` from this directory. It is not
gated behind anything private; the `~/work/...` paths and the
`build-site.sh` bug narrative below are written the way they are (no
absolute machine paths, no assumptions about who is reading) because this
is effectively a public document already.

Closes the largest open item in `notes/status.md`: Python and C++ rendered
as stock Furo — their own title, their own header, no port switcher, no
version switcher, none of the site's palette. A reader moving from `/ts/`
to `/py/` landed on what looked like a different website. Full design in
`notes/research/03-design-token-bridge.md`.

## The three artifacts

| File | What it is | Who loads it |
|---|---|---|
| `tokens.css` | ~25 semantic `--lt-*` custom properties (light default, `[data-theme="dark"]` override, `prefers-color-scheme` fallback) | Never linked directly by a foreign generator — pulled in transitively via each generator's own adapter stylesheet's `@import` |
| `shell.js` | Header/footer injection, the version switcher, and a dark-mode shim | Loaded directly via each generator's script-injection flag (Sphinx: `html_js_files`) |
| `README.md` | This file | Nobody; documentation only |

Both are served from a **stable, unversioned URL**
(`https://libtmux.org/_shell/tokens.css`, `.../shell.js`) — not copied into
each build. That is deliberate: a chrome-color fix or a header bug fix
reaches every already-published, immutable version prefix (`/py/v0.46.2/`,
`/cxx/v1.2.0/`, …) without rebuilding that version. See
`notes/research/00-DECISIONS.md` §6 ("load the shared header, footer,
version switcher and tokens at runtime from a stable URL").

Two research documents (`03-design-token-bridge.md`,
`14-lang-rust.md`, `07-ci-topology.md`) describe this prefix as
**versioned**, `/_shell/v1/`, for exactly this reason — a breaking change
bumps to `/_shell/v2/` instead of breaking every generator that already
baked in the v1 URL. A third (`16-lang-java-kotlin.md`) and this
assignment's own file list use the **unversioned** `/_shell/` path. This
implementation follows the assignment's literal paths
(`site/public/_shell/{tokens,shell}.{css,js}`). Flagged as an open
contradiction between research documents; adding a `v1/` segment later is a
rename of these two files plus every conf.py that references them, not a
redesign.

## Why the Astro shell itself does not consume these

The Astro shell (`site/src/styles/global.css`) has its own, richer,
multi-theme token system (`emerald`/`amber`/`sky`/`purple` palettes via
`html[data-theme]`, light/dark via `html[data-theme-mode]`). `tokens.css`
is deliberately the narrow, lowest-common-denominator subset a *foreign*
generator's own CSS can plausibly repaint with — Furo has no slot for four
selectable brand hues, only one accent. The two systems name their
attributes the same way for unrelated things (`html[data-theme]` means
"which brand palette" in the shell, "resolved light/dark" for this
bridge) — this only matters if a future shell page ever loads `tokens.css`
directly, which none does today. Flagged as an open naming collision
rather than resolved, since resolving it means picking a side without a
second consumer to test against.

## The adapter problem

`tokens.css` restyles nothing by itself. Each foreign generator paints
from its own variable system, so each needs a small **adapter
stylesheet** — a translation table from the ~25 `--lt-*` names onto that
generator's real variables, loaded through that generator's own override
mechanism. Today that is Furo, for the two Sphinx-rendered ports:

- `~/work/python/libtmux-python-docs/docs/_static/libtmux-org.css` (Python
  — `sphinx-gp-theme`, a Furo child theme)
- `~/work/libtmux/libtmux-cxx-docs/docs/_static/libtmux-org.css` (C++ —
  vanilla Furo via Doxygen → Breathe)

Both map the same ~25 names onto the same Furo `--color-*` contract
(harvested from upstream Furo's SCSS at
`~/work/python/gp-sphinx/packages/gp-furo-tokens/src/{light,dark}.ts` —
verified against the actual built output at
`_site/py/*/api/_static/styles/furo-tw.css` and
`_site/cxx/*/api/_static/styles/furo.css` before writing the mapping, not
assumed). The two files are near-identical and kept in sync by hand —
there is no shared npm package either Sphinx build could import from
(`gp-furo-tokens` is `"private": true`); this is the one duplication cost
the design accepts, and it is the *mapping* that is duplicated (~60 lines),
not the token *values* (which stay centralized in `tokens.css` via
`@import` — see "Rejected: vendoring" in
`notes/research/03-design-token-bridge.md` §1).

Every mapping in the adapter carries Furo's own stock color as a `var()`
fallback (`--color-brand-primary: var(--lt-color-accent, #0a4bff)`). This
is load-bearing: the site has never been deployed (`notes/status.md`), so
every page loads `tokens.css` cross-origin from wherever it is actually
served today — a fetch that 404s until DNS resolves. Per the CSS custom
properties spec, `var()` on an undefined property with no fallback
resolves to the guaranteed-invalid value, which would make every rule
reading `--color-background-primary` compute to nothing — transparent
backgrounds, UA-default text — strictly worse than the stock-Furo glitch
this closes. The fallback is Furo's own value, not a libtmux one, so
degrading means "looks like unmodified Furo," not "looks half-skinned."

Each conf.py wires the adapter in with two config values:

```python
html_static_path = ["_static"]  # cxx only — Python's already has this
html_css_files = ["libtmux-org.css"]  # appended after any project CSS
html_js_files = [("https://libtmux.org/_shell/shell.js", {"defer": "defer"})]
```

`html_css_files`/`html_js_files` accept a full external URL verbatim
(Sphinx's own `add_css_file`/`add_js_file`: a filename containing `://` is
never rewritten to `_static/…`) — confirmed against the installed Sphinx
source, not assumed from documentation. `libtmux-org.css` must be **last**
in the list: Sphinx emits `html_css_files` after every extension's own
bundled CSS (including Furo's), so appending guarantees the adapter's
`body { --color-x: var(--lt-y) }` overrides land after Furo's own
`--color-x` declaration at equal specificity and wins.

## The version switcher contract

`shell.js`'s `<libtmux-version-switcher>` custom element is a hand-kept
port of `site/src/components/VersionSwitcher.astro`'s inline script —
same element name, same `data-port`/`data-current` dataset keys, same
`/versions.json` fetch and schema check, same supported-only filtering,
same eol-suffix labelling, same path-preserving navigation on change, and
the same ecosystem-port suppression (a port whose `referenceMode` is
`'ecosystem'` never gets a switcher — its versions live on docs.rs /
pkg.go.dev / javadoc.io, which have their own). If
`VersionSwitcher.astro`'s contract changes, `shell.js` must change with
it; nothing enforces that automatically.

`shell.js` also carries a small, hand-kept-in-sync copy of the fields it
needs from `site/src/lib/ports.ts` (slug, display name, `referenceMode`,
and — for ecosystem ports — the exact `ecosystemHost.url`, copied
verbatim). A runtime script has no bundler and cannot import that module;
`ThemeScript.astro` already accepts the identical trade-off for
`theme-config.ts`, with the same comment shape, for the same reason.

## The dark-mode shim

"Shim, don't replace" (`03-design-token-bridge.md` §4): Furo keeps its own
toggle button, its own `theme` `localStorage` key, and its own
`body[data-theme]` attribute. `shell.js` never touches Furo's click
handler — it observes the resulting `body[data-theme]` mutation (via
`MutationObserver`, since Furo's toggle fires no event of its own) and
mirrors the *resolved* light/dark value onto `html[data-theme]`, which is
the attribute `tokens.css` actually reads. A page can legitimately show
two theme controls (Furo's native one, plus whatever the injected header
grows later) — both read the same synced state, so they cannot disagree,
which is the seam `03-design-token-bridge.md` §4 explicitly accepts rather
than papering over with a fork of Furo's toggle.

`notes/research/00-DECISIONS.md` §7.13 leaves the canonical cross-site
`localStorage` key an open decision ("pick one before `shell.js` ships").
This implementation picks `libtmux-theme` and records that choice in
`shell.js`'s own comments rather than in a separate document. It has not
been reconciled with `social-embed`'s `starlight-theme` key — that
remains open, and only matters if `libtmux.org` and `social-embed.org`
(or another `git-pull.com` property) are ever meant to share a dark-mode
preference across visits.

One accepted flash: Furo's inline pre-paint script sets
`body[data-theme]` synchronously, before `shell.js` (deferred) runs. If
the reader's explicit preference disagrees with the OS (e.g. chose "dark"
while the OS is light), `tokens.css`'s `prefers-color-scheme` fallback
briefly disagrees with Furo's own paint until `shell.js` sets
`html[data-theme]` explicitly. The "auto" case has no flash at all, since
`tokens.css`'s media-query block matches with no attribute present. This
is the same one-frame trade-off `03-design-token-bridge.md` §4 names
explicitly rather than rewriting Furo's boot script to defer to ours.

A sibling case is not just a flash: if `shell.js` itself fails to load
(same-origin as `tokens.css`, so this fails together with it, but keep the
two failure modes distinct) while the reader's explicit preference is
"dark" and the OS is light, `html[data-theme]` is simply never written —
Furo still paints dark correctly from its own `body[data-theme]`, but
`tokens.css`'s fallback block (`prefers-color-scheme: dark`) never
matches, so **every `--lt-*` token stays at its light value for the
session**, not just for one frame. The adapter's own `var(--lt-x,
<furo-stock-light>)` fallback then supplies the *light* stock color inside
a page Furo has painted dark — a legible but visibly wrong combination,
not a broken one. This is the direct consequence of `shell.js` being the
only thing that writes `html[data-theme]`; there is no second mechanism to
fall back to.

## Verifying it actually happened

`scripts/inject-shell.mjs` is the post-build smoke test: it reads
`site/src/lib/ports.ts` for the self-hosted Sphinx ports, walks every
built `<port>/<version>/api/` page, and asserts the adapter link and
`shell.js` script tag are present, the adapter still `@import`s
`tokens.css` from the real URL, every `--color-*` name the adapter writes
still exists in that build's own generated CSS (catches a Furo upgrade
silently renaming or dropping one), and every `--lt-*` name the adapter
reads exists in `tokens.css` (catches a typo on our side). Run it after
`scripts/build-site.sh`:

```console
$ node scripts/inject-shell.mjs
```

A port with nothing built yet is reported as skipped, not failed. Any
other failure exits non-zero.

This script proves the wiring is present and internally consistent — the
right tags exist, the right variable names exist on both sides of the
mapping. It does not prove the injected header/footer actually look right
next to Furo's own flex/sticky layout in a real browser; that visual QA
has not been done and is unverified.

**Known failure as of this writing**: running the check above reports
`py/stable` as failing every check, while `cxx/stable` passes. This is not
a bug in the adapter or in `shell.js` — direct `sphinx-build` runs against
`~/work/python/libtmux-python-docs/docs` (this file's own conf.py) produce
the correct `<head>` tags every time. The cause is in
`scripts/build-site.sh`'s `build_reference()`: it redirects `cxx` and
`dotnet` to their `docs-site` worktree when that worktree carries the
generator's entrypoint, but the equivalent `py)` case is missing from that
same `case` statement, so the Python build actually runs against
`~/work/python/libtmux/docs/conf.py` (the main checkout) instead of the
worktree this fix lives in. `build-site.sh` is not owned by this piece of
work; see the top-level summary for this contradiction reported upstream.
