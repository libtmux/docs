# Status: glitches and what is left to build

Written 2026-09-02 after a Chrome crawl and a full-tree audit of the assembled
site; updated the same day after five subsystems (widgets, content, the
design-token bridge, the parity normaliser, and CI) landed in parallel and a
verify-and-fix pass assembled and re-checked the combined tree; updated again
the same day after a sixth batch — five content agents landing the
per-language mechanism's actual prose in parallel (4 new topics, plus
language fences added to every existing concepts/guides/examples page) — and
a second verify-and-fix pass. Every item was observed, not assumed: the audit
script walks every built page, extracts the real content element (`<article
role="main">` for Sphinx, `<main>` for the shell), and flags emptiness and
rendered admonitions. The link crawl resolves relative URLs and follows every
internal link from `/`.

Page and flag counts moved three times across the two passes: 433 pages / 51
flagged (first audit) → 587 / 38 (widgets/content/bridge/parity/CI batch
assembled) → 587 / 36 (after that batch's two fixes) → 679 / 36 (baseline
going into this batch, per the assignment) → 735 / 32 (after the
per-language-content batch, this pass). The 679 → 735 growth is arithmetic:
4 net-new topic pages (environment, errors and exceptions, socket and
servers, waiting and retry) × 14 shell builds (root + 5 self-hosted ports ×
2 versions + 3 ecosystem ports × 1 unversioned prose build) = 56, and
679 + 56 = 735 exactly. The 36 → 32 drop traces to the rewritten port home
page (`site/src/pages/[port]/index.astro`, see below): rebuilding the old
version in isolation and measuring the same way the audit does shows
`/py/`, `/ts/`, `/dotnet/`, and `/cxx/` each under the THIN threshold (100,
126, 224, and 101 characters of extracted text) — an install command and a
one-line reference link is not much prose. The rewrite's hero, quickstart,
and cards put all four (and every other port) at 850+ characters. `/rs/`,
`/go/`, `/java/` measured thin in that same isolated rebuild (92, 132, 157)
but were never actually flagged thin in a real assembled tree, before or
after this batch — see "The ecosystem port home pages were silently
replaced by the site homepage" below for why. None of the 32 pages still
flagged are in new or per-language content; all 32 are pre-existing
Python/C++ reference and search pages (see the table below).

Fixed items are kept rather than deleted so the same mistakes are not
re-introduced.

## How to re-run the checks

Assemble and serve:

```console
$ bash scripts/build-site.sh
```

```console
$ bash scripts/serve.sh
```

Audit for empty/thin/admonition pages, then crawl for broken links:

```console
$ node scripts/audit-site.mjs
```

```console
$ node scripts/crawl-site.mjs
```

`scripts/inject-shell.mjs` is a third check, specific to the design-token
bridge — see "Python and C++ still look different once you're past the
header" below.

---

## Glitches found and fixed

### Empty and broken reference pages

| Was | Cause | Fix |
|---|---|---|
| `/cxx/*/api/libtmux/` rendered as a title and nothing else | `libtmux.hpp` is an umbrella header — 34 lines of `#include` and no declarations, so `doxygenfile` emitted nothing | Generator detects declaration-free headers, skips them, and lists them under "Umbrella headers" on the index |
| `/cxx/*/api/capabilities/` rendered a Breathe warning instead of content | Two headers are named `capabilities.hpp` (`libtmux/` and `libtmux/testing/`); Breathe cannot disambiguate a bare filename | Pages now reference the path-qualified name, `libtmux/capabilities.hpp` |
| C++ reference covered 27 of 31 headers | The generator globbed `include/libtmux/*.hpp` only, missing `include/libtmux/testing/` | Recurses; 29 documented pages plus 2 umbrella headers |

### Links that went nowhere

Nine broken internal links, found by crawling every page from `/`:

| Was | Cause | Fix |
|---|---|---|
| `/dotnet/stable/api/`, `/swift/stable/api/` | Landing page and port grid linked a reference that was never built | Ports carry `referencePublished`; the UI says "Reference not published yet" |
| `/rs/latest/`, `/go/latest/`, `/java/latest/` | Port switcher emitted a local version prefix for ecosystem ports, which have no local tree | `portHomeUrl()` sends ecosystem ports to their landing page |
| `/third-party-notices/` | The footer linked a page nobody had written | Page written, including the Doxygen GPL note |
| `/ts/stable/README.md` | The generated TypeScript reference links `../README.md`, relative to its own checkout | Staging rewrites it to the file on GitHub |

### The version switcher was mostly fiction

`versions.json` was derived from git refs, so it offered **125 Python
versions** while exactly two were built. Every other entry 404'd. A tag is
evidence that a release happened, not that its docs were published.

Fixed by reconciling the manifest against the assembled tree after the build:
**152 phantom entries trimmed**. Ecosystem ports now get an empty list,
because their versions live on docs.rs, pkg.go.dev and javadoc.io, and the
switcher is suppressed for them entirely.

### Structural duplication

Every port-plus-version build rendered the `[port]` route, so `/cxx/stable/`
also emitted `/cxx/stable/py/`, `/cxx/stable/rs/` and six more — **76 nonsense
pages** nothing linked to. Port landings are now scoped to the root build.
Total pages fell from 509 to 433.

### Sitemaps contradicted the robots tags

Each port's default build emitted its own sitemap advertising its copy of the
shared prose — the same URLs `Seo.astro` marks `noindex` and canonicalises
back to the root. Gating on `IS_DEFAULT` was not enough, because that is true
for every port's default version; the gate now also requires the root mount.

### `astro check` was not actually 0 errors

Found by this pass, not by the five parallel agents: `ports.ts`'s `Port`
interface never gained a `referencePublished: boolean` field when the
commit that introduced the flag (`f6b2acf`, before this batch) added it to
every object literal and to `referenceUrl()`/`hasReference()`/
`portHomeUrl()`. `astro check` had 11 type errors at `HEAD` — a
pre-existing gap this document previously didn't catch, not a regression
from this round. Fixed by adding the field to the interface. `astro check`
is 0 errors, 0 warnings again.

### Python's reference build skipped its own fixes

`scripts/build-site.sh`'s `build_reference()` redirects `cxx` and `dotnet`
to their `docs-site` worktree when it carries the generator's entrypoint,
but the equivalent `py)` case was missing from that redirect logic (only
present in an earlier, unrelated case block that computes the worktree
path, never in the one that actually switches to it). Python's reference
therefore built from `~/work/python/libtmux` — the plain checkout — instead
of `~/work/python/libtmux-python-docs`, silently discarding two fixes that
already existed in the worktree: the design-token adapter
(`html_css_files`/`html_js_files` wiring `libtmux-org.css` and `shell.js`)
and the `_templates/search.html` override that redirects Furo's dead-end
search page to `/search/`. Fixed with a one-line addition to the case
statement. Confirmed with `node scripts/inject-shell.mjs` (now passes for
`py/latest` and `py/stable`, previously failing every check per
`site/public/_shell/README.md`'s own "known failure" note) and with the
crawl (`/py/*/api/search.md`'s broken link is gone; see below).

### Sphinx's own search page is no longer a dead end

Both self-hosted Sphinx ports now serve a `search.html` override at
`/{py,cxx}/*/api/search/` that meta-refreshes to `/search/` (Pagefind,
covering the whole site) instead of rendering Furo's own search UI, which
needs a JS index this build never emits at that path. C++'s worktree
already had this template; Python's existed but was unreachable — see
"Python's reference build skipped its own fixes" above. Confirmed by
`audit-site.mjs` (both `search/` pages moved from `THIN,ADMONITION` to
counted as redirects) and by the crawl (`/py/*/api/search.md`'s 404 is
gone).

### The parity page is no longer a placeholder

`scripts/normalise-parity.mjs` (new) reads all four ports' per-symbol
parity ledgers — four different formats (.NET and Go structured JSON,
Java two Markdown tables, Swift five JSON files with no implementation
field at all) — resolves every ledger's cited evidence against that port's
own checkout (a test file for .NET, a test function for Go, a contract
test class for Java), and classifies each row `test-verified` / `claimed`
/ `unknown` by what actually resolves, not by how confident the ledger's
prose sounds. `site/src/pages/parity.astro` renders the result:
per-port summaries, a cross-port module table, and an explicit note that
the four ledgers are not pinned to the same Python revision (.NET and Java
pin `c4a980b`, Swift pins `988b02a`, Go records none). Spot-checked: Java's
892 rows resolve to 889 `unknown` + 3 `claimed`, matching the ledger's own
disclaimer that its files are "a catalogue, not a status report."

### The package installer widget is built and renders

`PackageInstall.astro` (new, plus its data pull from `ports.ts`) is on the
home page's quickstart section. Confirmed in the built HTML: all eight
`lm-pkg-install__tab` buttons with `data-tab-value`/`data-port` per port,
`data-active-port` set on the container, and the click-handling script
(inlined, not a separate chunk — tab switching, copy-to-clipboard, and
cross-instance `localStorage` sync via a `lm-pkg-install:change` event) is
present in the page and wires up `addEventListener('click', …)` against
`.lm-pkg-install__tab` and `[data-action="copy"]`.

### The home page is a real page, not a port grid

Hero, a quickstart section carrying the package-install widget, an
"eight ports" grid with each port's own install command, and onward links
to Concepts/Guides/Examples/Topics. Replaces the plain port-grid page this
document previously described.

### Topics, more guides, and sourced examples

`/topics/` (7 pages: architecture, traversal, context managers, pane
interaction, options and hooks, format-token fields, plus its index) did
not exist before this batch. `/guides/` grew from one page to seven
(attaching to tmux, sending keys, capturing output, querying and filtering
in practice, testing with libtmux, plus the existing getting-started and
index). Two more example pages were added (capture pane output, workspace
from a file), and `examples/index.md` and `guides/getting-started.md` were
rewritten to cite the specific file and test mechanism each port's own
doc-verification runs — a table of eight different mechanisms (`pytest`
doctests, a `check-doc-runnable.ts` gate, `go generate` drift checks,
`cargo test --doc`, `docs-tests`, `sync_snippets.py`, `check_readme.py`,
`check_examples.py`). Spot-checked one claim against source rather than
trusting the prose: `getting-started.md`'s `session.active_window` /
`pane.capture_pane()` walkthrough is quoted verbatim from
`~/work/python/libtmux/src/libtmux/{session,pane}.py`'s own doctests,
including the exact `capture_pane()` output. The other seven ports' cited
sources were not independently checked in this pass.

---

### The MCP installer widget now has a page

`McpInstall.astro` rendered nowhere: content pages are plain Markdown and
cannot embed an Astro component, and no `.astro` page had been written for
it. `/mcp/` is that page — install widget, scope guidance, and the ports
that ship a server. `rg -l lm-mcp-install _site` now matches in every
build rather than nothing.

### `/mcp/` asserted cross-port tool parity that does not exist

The page said "tool names and arguments are kept in step across ports" with
nothing behind it — a claim no single port's documentation could falsify,
which is why it survived. Extracting every port's registrations from its own
source (`scripts/gen-mcp-tools.mjs`) gives **110 distinct tool names across
the eight servers, six of which exist in all eight** (`capture_pane`,
`list_panes`, `list_sessions`, `list_windows`, `search_panes`, `send_keys`),
and 44 that exist in exactly one.

Two findings a reader needs before configuring a client, now on
`/mcp/tools/`:

- **Java and .NET prefix every tool with `tmux_` on the wire.** The other six
  do not. An agent told to call `capture_pane` finds nothing on a Java
  server.
- **C++ registers four tools on Windows, twelve elsewhere.** Eight sit behind
  `#if !defined(_WIN32)`, because psmux 3.3.7 "can report another process's
  same-name mutation as its own". On Windows the six-tool common vocabulary
  is two.

`/mcp/` also listed six ports as shipping a server. All eight do; the six was
a hardcoded list that predated checking.

### Version roots served the site homepage

`pages/index.astro` had no root-only guard, so every port+version
sub-build rendered its own copy of the site home page at that build's `/`
route. `/py/stable/` — where the version switcher lands — said "libtmux"
instead of "Python stable". Ecosystem ports had the louder version of the
same bug, their real landing pages overwritten. Both now branch on the
build's own port.

---

## Previous batch: the per-language mechanism's actual content, verified

The mechanism (`remark-port-code.mjs`, proved on `concepts/transports.md`)
was already built. This batch's five content agents used it: language
fences were added to every existing concepts/guides/examples page across
all eight ports, and four more topic pages were written (environment,
errors and exceptions, socket and servers, waiting and retry) — `/topics/`
is now 10 content pages plus its index, up from 6 plus its index. `site/src/pages/[port]/index.astro`
was also rewritten in the same batch, from a plain install-and-reference
page into a per-port home page (hero, quickstart, cards into that port's
own Topics/Guides/Examples/reference) — see the two subsections below for
what that rewrite broke and what it got right.

### Confirmed clean: no port build leaks another port's language

Checked all 28 Markdown pages under `src/content/docs/` (5 concepts,
7 guides, 4 examples, 11 topics — each count including its section index —
plus third-party-notices) against all 8 ports' assembled output: every
`data-language` value in a port's own
tree is either that port's language or a shared one (`console`, `plaintext`,
and similar). Zero cross-port leaks. The three pages the assignment named
specifically (`concepts/transports`, `guides/getting-started`,
`examples/attach-and-send-keys`) each show exactly `console <language>` per
port on the final assembled tree:

| Port | Languages present |
|------|--------------------|
| py | console, python |
| ts | console, typescript |
| rs | console, rust |
| go | console, go |
| java | console, java |
| dotnet | console, csharp |
| cxx | console, cpp |
| swift | console, swift |

### Confirmed clean: every port has *a* fence, or an honest reason it doesn't

The leak check above answers "does a wrong language appear"; it doesn't
answer "does *this* port's language appear at all." A second pass checked
that, across every prose page × every port. Every miss resolved one of two
ways, and none needed a new fence:

- **A verified, on-the-record gap note.** `topics/environment.md` (C++:
  `Server::from_env()` exists and nothing past it — checked against
  `include/libtmux/server.hpp`, no `Session`/`Window`/`Pane::from_env()`
  found), `topics/format-tokens.md` (Rust: the field is gated the same way
  in `formats.rs`, but the page says outright it didn't verify the
  accessor's exact name rather than guessing one), `guides/testing-with-
  libtmux.md` (TypeScript: quotes the fixture harness's own "internal and
  unpublished" doc comment), and `examples/workspace-from-file.md` (Python:
  quotes the README's own `tmuxp` table row; C++: quotes
  `examples/workspace/README.md`'s "not really an example. This is a
  **consumer**") — all four checked against the cited source and confirmed
  accurate.
- **Already covered on a different page.** `guides/querying-and-filtering.md`
  says up front it picks up where `concepts/queries.md`'s table stops
  (Python/TypeScript/Java), so Java's absence there isn't a gap — it has a
  fence on the other page. Bare index pages (`/topics/`, `/guides/`,
  `/examples/`, `/concepts/`) and `third-party-notices` carry no fences at
  all by design — the page *is* a table of links, not a walkthrough — and
  `topics/errors-and-exceptions.md` is a cross-port comparison table by
  design (its "content" is the table, same as `concepts/queries.md`'s
  cardinality table).

### Honesty spot-check: far past five names, zero fabricated APIs

Verified against each port's real checkout, not sampled at the assignment's
five-name floor: every language fence in `concepts/transports.md` and
`guides/getting-started.md` (all 8 ports — `Server::new`/`new_session`,
`session.active_window`/`new_window`, `window.active_pane`,
`pane.send_line`/`send_keys`/`capture`, and each port's equivalents), the
inline C++ blocks in `examples/attach-and-send-keys.md`, the dense
error/retry-state table in `topics/errors-and-exceptions.md` (`LibTmuxException`,
`TmuxCommandError`/`TmuxTransportError`.delivery, `TmuxDispatchState`,
`DispatchOutcome`, `CommandFailure`/`DeliveryStatus`, `ControlModeErrorKind`),
the query/filter table in `concepts/queries.md` (`tmuxq.Where`/`PaneFilter`/
`SearchPanes`, `libtmux::matching`/`exactly_one`/the `window::`/`pane::`
field namespace, `Selections.exactlyOne`), and the format-token absence
idiom in `topics/format-tokens.md` (`pane.pane_dead_signal`, `.deadSignal`,
`.DeadSignal()`, `.floating()`). Every one resolved to a real, matching
declaration. Zero fabricated method or type names found.

### `[port]/index.astro`'s quickstarts overclaimed their own provenance, twice

Two of the eight hard-coded per-port quickstart snippets in the rewritten
port home page had a `source` string making a claim about the code that
wasn't quite true of the code itself — not a fabricated API (all eight were
verified against source and are accurate), but a provenance claim stronger
than what was actually true:

| Port | Claimed | Actually | Fix |
|------|---------|----------|-----|
| Rust | "the crate README's own \"Drive tmux\" section, verbatim" | the code had a paraphrased comment, `echo built` instead of the README's `echo hello`, and an `assert_eq!` swapped in for the README's print loop | replaced the code with the README's block verbatim, so the "verbatim" claim is now true |
| Java | "every Java snippet in the README is compiled and run against a real tmux by docs-tests" | this exact snippet carries the README's own `<!-- snippet: compile-only: ... -->` marker — `docs-tests` compiles it but does not run it, by the snippet's own stated reason (it would race the suite's own server) | reworded the `source` string to say so |

### The ecosystem port home pages were silently replaced by the site homepage

`/rs/`, `/go/`, and `/java/` each served a copy of the site's main landing
page (hero, all-eight-ports install widget, a Python-only quickstart) —
which happened to look plausible, since it is a real, complete page, just
the wrong one. `site/src/pages/[port]/index.astro`'s own per-port content
(hero, that port's install command, that port's quickstart, cards into its
own Topics/Guides/Examples) was never reachable at those three URLs.

**Cause:** `build-site.sh` builds the shell once at the root (`base=/`),
which is where every port's `[port]/index.astro` page actually renders —
its own `getStaticPaths()` guard only emits routes there. For each
ecosystem port it then runs a *second*, full site build scoped to
`base=/<slug>/` so that port gets its own copy of the shared prose
(`/rs/concepts/…`, `/rs/guides/…`, and so on), writing straight into
`_site/<slug>/`. `[port]/index.astro`'s guard correctly emits nothing in
that second build — but `site/src/pages/index.astro` (the site homepage)
carries no such guard, so it renders unconditionally at that build's own
`/` route, which is `_site/<slug>/index.html`: the exact path the first
build had just written the real port home page to. This was latent before
this batch — the page it replaced was generic enough (an install line and
a bare reference link) that being swapped for the homepage was hard to
notice; the new page's per-port quickstart and cards made it visible.
`build-site.sh` was not touched by any of the five content agents; this was
sitting in already-committed infrastructure and surfaced by the new content.

**Fix:** `build-site.sh` now snapshots each port's home page (from
`_site/<slug>/index.html`) right after the root build, and restores it over
whatever the ecosystem port's prose-only build wrote there. Confirmed on
the reassembled tree: `/rs/`, `/go/`, `/java/` show `Pick your language
below` (the homepage's own quickstart intro) zero times, each has exactly
its own port's `data-language`, and the crawl and audit are unaffected
(still 1 broken link, still 735/32). Self-hosted ports never had this
problem — their per-port sub-builds are scoped to `<slug>/<version>/`, a
directory the root build's `<slug>/index.html` never shares.

---
## This batch: references completed, claims made checkable

Final tree: **1,195 pages**, 1,155 reachable, 2 broken links (both the
upstream `genindex.md` twin), 32 flagged pages (all pre-existing Python
reference pages), `astro check` clean. Four checks now run against the
source without needing a build — see `scripts/README.md`.

Four things landed, each closing a gap between what the site claimed and
what it could demonstrate.

### .NET went from "model-only" to 215 rendered pages

`/dotnet/*/api/` did not exist. docfx was wired up as far as `docfx
metadata`, whose default output is an intermediate YAML model nothing
here consumes — the build printed `model-only` and moved on.
`--outputFormat markdown` turns the same command into a Markdown emitter,
which is the shape the TypeScript port already feeds the shell, so the
work was staging rather than rendering.

Seven of eight ports now publish a reference. Counting by where it is
served: four self-hosted here (Python, TypeScript, .NET, C++), three
deep-linked to docs.rs, pkg.go.dev and javadoc.io.

What staging had to fix, none of it visible in a diff:

| docfx emits | Why it breaks here | Fix |
|---|---|---|
| `Foo.md` cross-links | 404 once pages are directories | rewritten to `../foo/` |
| `<xref href="..."></xref>` | no browser knows the tag, so it renders as *nothing* — the reference silently vanishes | 93 resolved by longest-prefix match against the emitted page set, or to inline code for a BCL type |
| `Foo.md\#Bar\_Baz` | backslash-escaped fragments, so the obvious `\.md(#...)` pattern matches none of them | escapes accepted, then stripped |

Two of the three bugs found afterwards were not about .NET at all:

- **Astro's glob loader slugifies ids.** `libtmux.client.md` became
  `libtmuxclient`, so every cross-reference the staging script wrote
  resolved to nothing — while the build reported success. The `api`
  collection now keeps the staged filename verbatim.
- **The index's 215 links all 404'd.** Type pages sit at `api/<uid>/` and
  reach a sibling with `../`; the index sits at `api/` and is already in
  that directory. Same generator, same-looking Markdown, one level of
  difference. Found by following a link on the built page, not by reading
  the code.
- **The CloudFront function decided "is this a file?" by looking for a
  dot**, so `/dotnet/stable/api/libtmux.client` passed through to the
  origin as an asset instead of redirecting to the trailing-slash form.
  Now an allowlist of extensions the build actually emits, which also
  closes the same hole for `/py/v0.46.2` — a residual the old comment
  accepted rather than fixed.

Known limitation, recorded rather than fixed: docfx's `toc.yml` is
discarded (the index is synthesised from the same data), so a reader on a
type page has no sibling-type navigation beyond "API reference" back to
the index. Acceptable for 215 pages behind an index and a search box; it
would not be for several thousand.

### Every cited source path is now checked against its port

The examples and topics pages carry code three ways: read out of a
checkout by `file="..."`, hand-quoted under a `// From <path>` comment,
and named in each page's "Where this comes from" table. Only the first
was self-checking. `scripts/check-citations.mjs` resolves all 59 against
the eight checkouts.

It deliberately does not require a hand-quoted fence to be byte-identical
to its source — several are excerpts with a clarifying comment added,
which is what the tables already say. A wrong path is a bug; a shortened
quote is an editorial choice.

Three citations named no real file, all of them shorthand that reads fine
and resolves to nothing: `src/lib.rs` for
`crates/tmux-workspace/src/lib.rs` (four crates match that path, none is
at it), and two `_generated/*.ts` paths missing `packages/libtmux/src/`.

### A PR preview now contains itself

`deploy-shell.yml` has published pull request builds under `/pr-<n>/`
since it was written, and nothing in the shell knew. Every root-relative
URL it emits — header links, footer port list, both switchers, ports.ts's
three URL builders, the version manifest fetch, the favicon — pointed at
production.

Not a broken link a crawler catches: a working link to the wrong site,
taken with the preview's own header still on screen. A reviewer clicking
through would land on real documentation and notice nothing until their
change was missing from it.

`LIBTMUX_DOCS_ROOT` already existed for this and `rehype-site-root`
already consumed it — but no workflow set it, so that pass had been a
no-op since it was written, and covered only prose regardless. It is now
set by the preview build and read through one helper by everything that
emits an absolute URL. `scripts/check-preview.sh` fails the build if any
escape: 33 pages, zero escapes.

Worth recording because it looks wrong: `import.meta.env.BASE_URL` cannot
stand in for this. A per-port build has `base=/py/stable/` and a preview
has `base=/pr-42/` — same shape, and only one moves the site root.

### llms.txt, built from resolved content rather than source

`/llms.txt` and `/llms-full.txt` now exist, and a per-port build gets a
per-port pair: `/ts/stable/llms-full.txt` carries TypeScript and no other
language. That is the per-language mechanism applied to the one consumer
that cannot see the language switcher.

The interesting part is what it nearly shipped. `entry.body` is *source*,
and a `file="examples/capture/capture.ts"` fence is empty in source — the
remark plugin fills it while rendering HTML. Concatenating source would
have produced a file whose TypeScript examples were all blank: exactly the
source-versus-resolved bug `notes/research/10-llms-and-agents.md` was
written to document, reintroduced by the document's own implementation.
One shared `readFence()` now serves both.

Scope stated rather than implied: the generated reference is indexed in
`llms.txt` and not inlined into `llms-full.txt`. .NET's reference alone is
1.5 MB across 215 files, which would defeat the context window the file
exists to fit into.

---

## Glitches still open

### Python and C++ still look different once you're past the header

The wiring for the shared header/footer/version-switcher/token bridge
(`notes/research/03-design-token-bridge.md`) is now built and
smoke-tested — `libtmux-org.css` and `shell.js` are linked in the `<head>`
of every self-hosted Sphinx page, `scripts/inject-shell.mjs` passes for
both `py` and `cxx` at both versions, and the `<script>`/`<link>` tags
resolve to real files under `site/public/_shell/`. What is **not**
verified is what a reader actually sees:

- Both files load from `https://libtmux.org/_shell/…` — a stable,
  unversioned production URL, per design (a chrome fix should reach an
  already-published version without rebuilding it). That URL resolves
  nowhere until DNS and the deploy actually happen (still true; see
  Delivery below), so **every local page still paints as stock Furo** —
  the fix is real but invisible until the site is live.
- No visual QA has been done even against a URL that did resolve. The
  design intentionally keeps a `var(--lt-x, <furo-stock-value>)` fallback
  on every mapped property specifically so a `tokens.css` fetch failure
  degrades to "looks like unmodified Furo" rather than an unstyled page —
  which also means a broken mapping and a not-yet-deployed site currently
  look identical from the outside.
- `site/public/_shell/README.md` (new, ships at `/_shell/README.md`)
  records three more open items worth tracking rather than re-discovering:
  research docs disagree on `/_shell/` vs. a versioned `/_shell/v1/`
  (this implementation is unversioned, matching the assignment's literal
  file paths); `html[data-theme]` means "brand palette" in the Astro shell
  and "resolved light/dark" in the bridge — a naming collision that only
  bites if a shell page ever loads `tokens.css` directly; and `shell.js`
  hand-copies fields out of `ports.ts` and out of `VersionSwitcher.astro`'s
  contract, with nothing enforcing either copy stays in sync.

### Upstream, in the Python port rather than here

- `/py/*/api/genindex.md` 404s. `sphinx-gp-llms` emits a Markdown twin link
  for Sphinx's generated `genindex.html`, which has no Markdown source.
  Same class of bug as the twin issue recorded in
  `notes/research/10-llms-and-agents.md`. (`/py/*/api/search.md` no longer
  404s — not an upstream fix, a side effect of the local
  `_templates/search.html` override now actually loading and replacing
  the page that used to link a twin at all; see "found and fixed" above.)
- `_static/tabs.js` 404s on every Python reference page — an asset
  referenced by the theme but not emitted. Not exercised by
  `scripts/crawl-site.mjs` (it skips `.js` by design); still present per
  the original Chrome crawl and unchanged by anything in this pass.

Both live in `~/work/python/libtmux` and `~/work/python/gp-sphinx`, which are
public repositories, so they are reported rather than patched here.

### Shared prose is copied into every build

`/cxx/stable/concepts/queries/` and its siblings are byte-identical copies
of `/concepts/queries/`. Correctness is handled — `noindex` plus a
canonical back to the root — but the page this note is copied into is now
bigger: 28 prose pages (5 concepts, 7 guides, 4 examples, 11 topics, plus
third-party-notices), up from 24 last pass and roughly 10 when this item was
first written, each still duplicated into all 10 port builds. Worth deciding
whether port builds should emit prose at all.

### The deploy workflow has one more reserved-prefix hole than it fixes

`notes/decisions/port-root-redirect.md` (new) resolves the `/<port>/`
landing-page-vs-reserved-prefix collision `deploy-shell.yml` used to fail
on outright, by teaching `publish-root` to `cp` (never `sync --delete`)
exactly one `index.html` per reserved slug. But its own text says the
fix, as implemented, makes `_shell` fail the same reserved-prefix check
that used to fail on every port slug: `site/public/_shell/` now makes the
build emit `dist/_shell/{shell.js,tokens.css,README.md}`, unversioned,
which contradicts `notes/research/07-ci-topology.md`'s ownership table
(`_shell/v*/**` as the shell's own prefix) and isn't resolved by either
that decision or the design-token-bridge work — recorded as a known
residual by both, not fixed by either. Nothing in this pass exercises
`deploy-shell.yml` (the site has never been deployed), so this is
reported, not verified against a real run.

---

## Features not built yet

### Content and information architecture

- **Topics beyond the ten built.** The Python port has 15 topic pages
  total (`~/work/python/libtmux/docs/topics/`). This site now has 10 content
  pages under `/topics/` (up from the 6 named in the previous pass's list —
  environment, errors and exceptions, socket and servers, waiting and retry
  are all new this batch), but the four new ones are cross-port syntheses
  rather than 1:1 renamed adaptations of one specific Python file the way
  the first six were, so
  "how many of Python's 15 remain unadapted" no longer has a clean count —
  some of Python's own topics (`automation_patterns`, `clients`,
  `configuration`, `design-decisions`, `filtering`, `floating_panes`,
  `public-vs-internal`, `self_location`, `workspace_setup`) still have no
  cross-port page here at all.
- **Argument parity across MCP tools.** `/mcp/tools/` now shows which tools
  each port registers, but "registers a tool by this name" is weaker than
  "accepts the same arguments". Nothing compares parameter names, types or
  defaults, so two ports can both list `capture_pane` and disagree about
  what `start` means.

### Reference coverage

Seven of eight ports publish one. Four are self-hosted here (Python,
TypeScript, .NET, C++) and three deep-link to their ecosystem host.

- **Swift** is the only port with no reference, and the gap is one command
  wide, not a design problem: `Sources/LibTmux/LibTmux.docc/` exists,
  `Package.swift` already depends on `swift-docc-plugin`, and
  `build-site.sh` has the DocC branch written. What is missing is a Swift
  toolchain — `mise install swift@6.2.4`, roughly 3 GB installed on a disk
  currently at 98% (20 GB free). Not attempted here for that reason rather
  than a technical one.
- **Rust, Go, Java** deep-link out by policy and need no local build — but
  Rust's `[package.metadata.docs.rs]` rustdoc-args, which is how docs.rs picks
  up our palette, is not wired up.
- **.NET's reference has no per-type navigation.** docfx's `toc.yml` is
  discarded in favour of a synthesised index, so a reader on
  `libtmux.client` reaches a sibling type through the index or search, not
  a sidebar.

### Site systems

- **Translations: the mechanism is built; the corpus is one page.** `/ja/` and
  `/ja/concepts/` exist, hand-rolled inside the existing catch-all rather than
  through `astro:i18n` (see `05-i18n-translations.md` for why). What works:
  locale from the leading path segment, `<html lang>`, a reciprocal hreflang
  cluster emitted only where a translation really exists, locale-scoped
  sidebar and `llms.txt`, and the three-state `source_commit` staleness check
  — all three states exercised, `stale` by moving the English source's sha and
  rebuilding. What is not built: a locale switcher widget (with one locale it
  is a control with nowhere to go), the Sphinx `.po` lane for the Python and
  C++ references, and any human review — the one Japanese page carries
  `reviewed: false` and says so on the page.
- **Search UI.** Pagefind indexes the whole assembled tree, but there are no
  per-language or per-version filters, and generator chrome is not excluded
  from the index. .NET's 432 reference pages make the second of those more
  pressing than it was.
- **Markdown twins.** `llms.txt` and `llms-full.txt` are built, per port and
  per version, from resolved content. The per-page `.md` sibling is not:
  the shell's own pages could emit one cheaply, but the Sphinx-rendered
  ports would need the upstream `_md_twins.py` fix first (see "Upstream" in
  Glitches still open), and a family that covers half the site is worse
  than one that covers a stated part of it.
- **Dark mode across generators, beyond the shim.** `shell.js` now mirrors
  Furo's resolved `body[data-theme]` onto `html[data-theme]` via
  `MutationObserver` (see "Python and C++ still look different" above) —
  deliberately a shim, not a merge: Furo keeps its own toggle button and
  `localStorage` key, the shell keeps its own. Ports/generators outside
  Sphinx (TypeScript's Astro-rendered reference, C++ once its bridge is
  visually verified) are not part of this shim at all. Nothing unifies the
  storage keys or the toggle UI itself.

### Delivery

- **Nothing has ever been deployed.** The CloudFront function, bucket policy
  and workflows are written but have not run. No S3 bucket, no distribution,
  no OIDC role. This is also why the design-token bridge is invisible
  locally — see "Python and C++ still look different" above.
- **`libtmux.org` has no DNS records.** Registered on Cloudflare, pointing
  nowhere.
- **PR previews** have never run against S3, but the build shape they use is
  now exercised locally by `scripts/check-preview.sh` and no longer leaks
  links to production.
- **The `/<port>/` reserved-prefix collision is decided, not fully closed.**
  `notes/decisions/port-root-redirect.md` (new) keeps the landing page at
  `/<port>/` and teaches `deploy-shell.yml`'s `publish-root` job to write
  just that one file per reserved slug instead of failing outright — but
  the same decision records that its own implementation makes `dist/_shell/`
  fail the identical check today. See "The deploy workflow has one more
  reserved-prefix hole than it fixes" above.
