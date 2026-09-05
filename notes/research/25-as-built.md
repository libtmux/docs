# As built: what implementation proved, disproved and changed

The other 24 documents in this folder were written before a line of the site
existed. They are a design. This one records what happened when it was built,
which parts of the design held, and which were wrong.

Read it alongside `00-DECISIONS.md`. Where this file and an earlier document
disagree, this one describes reality: it was written from a running site.

Site state at the time of writing: **1,195 pages**, 1,155 of them reachable
by following links from `/`. Four self-hosted references built (Python,
TypeScript, .NET, C++), three deep-linked to ecosystem hosts, one port
(Swift) skipped for want of a toolchain. `astro check` clean, two broken
links (both upstream, the same `genindex.md` twin), 32 pages flagged by the
audit and every one of them a pre-existing Python reference page. Pagefind
indexes the whole tree. Served locally from `_site/`.

An earlier revision of this line said 609 pages and three references. The
.NET reference landing added 432 pages of its own; the rest is per-language
prose. Numbers in the body below are from the pass that wrote each section
and are not retro-fitted — where a count differs from this header, the
header is current.

---

## Design decisions that held

| Decision | Evidence from the build |
|---|---|
| Own the Astro shell; no documentation framework | The whole shell is ours. The one thing a framework was supposed to give us free — Pagefind — is a 40-line integration. Nothing about the framework's absence cost time. |
| api-extractor for TypeScript, not TypeDoc | Confirmed again in practice. TypeDoc was never usable at any point; api-extractor produced a 2,709-line reference that renders through the shell. |
| Doxygen XML to Breathe to Sphinx for C++ | Works. 33 pages, 295 signatures on `entities` alone. No Doxygen HTML is published, so the licensing question stayed moot. |
| Pagefind across heterogeneous output | Works exactly as claimed. One index spans Astro-rendered pages and two separate Sphinx builds, which is the whole argument for indexing rendered HTML. |
| Deep-link Rust, Go and Java to their ecosystem hosts | No CI, no build, no maintenance for three of eight ports. |
| Runtime-loaded shell rather than baked-in chrome | Proved its own value immediately: a one-line path change fixed the chrome on every already-built Sphinx page with no rebuild of those pages. |
| Immutable version prefixes, canonical to the default alias | Held. The only correction needed was to the *sitemap* gate, not the model. |

## Design decisions that were wrong

### C++ needed a generator, not hand-written directives

`18-lang-cxx.md` proposed hand-writing about 26 Breathe directive stubs
because Exhale is stale. Hand-writing them is what produced the first two
glitches a reader found:

- `libtmux.hpp` is an umbrella header — 34 lines of `#include`, no
  declarations — so its page rendered a heading and nothing else.
- Two headers are named `capabilities.hpp`, and a bare filename made Breathe
  emit "Found multiple matches" into the page body.
- The naive glob missed `include/libtmux/testing/` entirely: 27 of 31 headers.

The fix was a small generator that recurses, path-qualifies every
`doxygenfile` target, and detects declaration-free headers. The lesson
generalises: a per-header page list is derived data and should be generated,
not authored.

### "Three ports render through Astro"

`content.config.ts` and several research documents say TypeScript, .NET and
Go render through the Astro shell. `ports.ts` — the source of truth — has Go
as `ecosystem`. Only **two** ports are Astro-rendered. The research reflected
an earlier draft of the policy and was never reconciled.

### The MCP widget's own documentation overstated it

Porting the widget from `libtmux-mcp` surfaced three inaccuracies in the
source that the research had taken at face value:

- Its module docstring claims 117 panels across 13 scopes. The actual client
  tuple yields **126 panels across 14 scopes** — the figures predate a client
  being added.
- Both the source comments and this project's research state that pipx bodies
  embed an absolute date because pipx's bundled pip rejects the duration form.
  The code never does this. The sentinel and its substitution filter exist,
  but nothing produces the sentinel — dead code from a dropped design.
- `widget.js` hand-duplicated a defaults map with 7 entries where the Python
  side has 8, so one client would have rendered a blank panel. The port reads
  the data from the DOM instead, so there is no second copy to drift.

---

## Problems only building could reveal

None of these were predictable from reading tool documentation. Each was found
by walking the assembled tree.

### The version manifest was mostly fiction

Deriving `versions.json` from git refs offered **125 Python versions** when
two were built. Every other entry 404'd. A tag records that a release
happened, not that its docs were published. The manifest must be reconciled
against the output tree; 152 phantom entries were trimmed.

This is the single most valuable thing the build taught, and no amount of
design would have caught it — the manifest was correct by its own definition.

### Routes fan out across builds in ways the design ignored

The shell is built once per port and version. Any route with
`getStaticPaths` therefore runs in *every* build, so the port-landing route
emitted `/cxx/stable/py/` and seven siblings — **76 pages** nothing linked to.
Routes that belong to the site root need an explicit guard.

### The sitemap contradicted the robots tags

Gating the sitemap on "is this the default version" is not enough, because
that is true for each port's default. Every port advertised its own copy of
the shared prose — the same URLs marked `noindex`. The gate must also require
the root mount.

### A build script can silently use the wrong source

`build-site.sh` redirected `cxx` and `dotnet` to their `docs-site` worktree
but omitted `py`. Python's reference built from the plain checkout for several
rounds, silently discarding two fixes that already existed in the worktree.
Nothing failed; the output was simply stale. The `inject-shell.mjs` smoke test
now catches this class of failure by asserting the chrome is present.

### Parity ledgers are not comparable

The four ports that publish a parity ledger pin **different Python
revisions** — two at `c4a980b`, Swift at a commit 60 past `v0.62.0`, Go at no
revision at all, only per-file digests. Swift's module counts run about 4.5x
the others for the same file because its extractor counts each inherited
dataclass field once per subclass rather than once at the base.

Any cross-port parity table that does not say this is misleading. `/parity/`
now marks every row `test-verified`, `claimed` or `unknown` by resolving the
cited evidence against the port's own checkout, rather than trusting the
ledger's prose.

### tmux's own behaviour is not what the docs imply

Writing the Topics pages surfaced that tmux's window and pane hook scopes are
largely fiction: `set-hook -w` and `-p` report success but the hook lands in
the session table regardless. Three ports independently encode this — a Java
doc comment, a Rust `OptionScopeMismatch` guard, and C++ simply not exposing
`hooks()` at that scope. Documentation that describes the flags without this
would be wrong in a way no single port's source reveals.

---

## Still unreconciled between design and build

These are real contradictions, not oversights, and each needs a decision.

| Design says | Build does | Consequence |
|---|---|---|
| Shell assets live at a versioned `/_shell/v1/` prefix (three documents) | Unversioned `/_shell/` | A breaking change to the shell contract cannot be made without touching every consumer. Renaming two files fixes it. |
| Each repository writes its own `manifest/<port>.json` fragment | One global `/versions.json`, written by the assembly script | Nothing aggregates fragments into the global file, so a version published by a port's own CI would not reach the switcher. |
| `_shell/v*/**` is the shell's own deploy prefix | `_shell/` is on the deploy denylist | The publish-root job will fail on it. Recorded in `notes/decisions/port-root-redirect.md`. |
| A single dark-mode key across git-pull.com properties | `libtmux-theme` here, `starlight-theme` in social-embed | Only matters if the sites are meant to share a preference. `00-DECISIONS.md` §7.13 left this open; shipping forced a choice. |

## What the research got right that is worth keeping

The adversarial verification pass earns its place. Of ten load-bearing claims,
one was confirmed, one refuted and eight needed correction — and the two that
mattered most in practice (TypeDoc being structurally dead against TypeScript
7, and DocC needing no SPA rewriting) both came from running the tool rather
than reading about it. Every one of those verdicts held up during
implementation.

The reference-hosting policy also held under pressure. It survived contact
with a working build without a single case where deep-linking felt like a
compromise.

---

## Second round: what completing the references taught

### An intermediate model is not a reference

.NET sat at `model-only` for the whole first round — `docfx metadata` ran,
produced YAML, and nothing consumed it. That reads in a summary table like
"nearly done". It is not nearly done; it is zero pages. The distance from
there to 215 rendered pages was one flag (`--outputFormat markdown`) and a
staging script, which is to say: the design was right and the status line
was flattering. Any port reporting an intermediate artefact should be
counted as unbuilt.

### Three generators, three ways to break a link, none of them visible in a diff

The .NET staging pass had to undo three separate docfx conventions, and
what they have in common is that the broken output looks correct:

- `Foo.md` hrefs 404 once pages are directories.
- `<xref href="..."></xref>` renders as **nothing**. An unknown element is
  not an error; the reference simply vanishes from the page.
- Fragments are backslash-escaped (`Foo.md\#Bar\_Baz`), so the obvious
  rewrite pattern matches none of them and silently leaves `.md` in place.

Then Astro's own glob loader slugified `libtmux.client` to `libtmuxclient`,
breaking every link the staging script had just written — while the build
reported success. Four failure modes, one shared property: nothing throws.
The only thing that caught any of them was fetching a built page and
following a link.

### The index and its own children disagree about "up"

`../foo/` is correct from `api/<uid>/` and wrong from `api/`. Same
generator, same-looking Markdown, 215 links pointing one directory too high.
Verifying "the cross-links work" on a type page proved nothing about the
index, and it was the index a reader hits first.

### A claim no single port could falsify was false

`/mcp/` asserted that "tool names and arguments are kept in step across
ports". Extracting every port's registrations from its own source
(`scripts/gen-mcp-tools.mjs`) gives **110 distinct tool names across the
eight servers, six of which exist in all eight**, and 44 that exist in
exactly one. Java and .NET prefix every tool with `tmux_` on the wire, so an
agent that works against one of those two finds nothing by name on the other
six.

This is the most valuable thing this round found, and it is a class, not an
incident: a cross-port claim is exactly the kind that survives review,
because no reviewer working in one port's repository is in a position to
check it. Anything this site says about all eight needs a generator behind
it.

The extraction is validated rather than assumed, and every version of it
before the last was wrong in a way that would have shipped a plausible
table:

| Weak anchor | What it counted | Caught by |
|---|---|---|
| `fd` given both a glob and `.` | this repository's own Markdown, as Python tools | the docs cross-check refusing to write |
| a bare `*.go` scan | nine tool descriptors constructed inside `_test.go` files | comparing against a hand-filtered run |
| `Name:` unanchored | the Go *server's* own name, `libtmux`, as a tool | reading the three non-`_tools.go` matches |
| `"tmux_…"` as the .NET pattern | nothing wrong — but it made "every tool is prefixed" self-confirming, since an unprefixed tool could not be found | asserting the prefix from a pattern that does not assume it |
| `case X = "y"` for Swift | 35 of 38 tools: Swift derives an absent rawValue from the case name, so `case snapshot` *is* the tool `snapshot` | two of the three missing names, `rename` and `select`, also belong to Java — a name cannot be unique to one port and shared at the same time |

Three guards now stand between the script and a plausible-but-wrong table:
the Python rule must reproduce, name for name, the 54 tools libtmux-mcp's own
`docs/tools/` documents; every tool in a port declaring a wire prefix must
actually carry it; and a missing checkout is a hard failure rather than a
port silently scoring zero. The last one matters most — a partial matrix is
indistinguishable from a real finding.

### A preview that pointed at production

`deploy-shell.yml` published PR builds under `/pr-<n>/` from the day it was
written, and nothing in the shell knew — every root-relative URL went to the
live site. `LIBTMUX_DOCS_ROOT` existed for precisely this and no workflow
ever set it, so `rehype-site-root` had been a no-op since it was written.

Worth generalising: a configuration knob with no consumer and no test is
indistinguishable from a knob that works. `07-ci-topology.md` described the
preview mechanism correctly and the description was never exercised.

### `entry.body` is source, not content

`llms-full.txt` was one line from shipping the exact bug
`10-llms-and-agents.md` was written to document. Astro's `entry.body` is
raw Markdown, and a `file="..."` fence is *empty* there — the plugin fills it
while rendering HTML. Concatenating bodies would have produced a full-text
file whose TypeScript examples were all blank.

The research document names the rule ("read from the resolved doctree, never
the source path") and its own implementation reached for the source path
anyway, because in Astro the source path is the convenient one. Documenting
a trap does not disarm it.

### The i18n fallback the design asked for is worse than absence

`05-i18n-translations.md` specifies a three-state page: **translated**,
**stale**, or **missing** — and for *missing*, "falls back to the English
entry" with a banner, a canonical back to the English original, exclusion
from that locale's sitemap and hreflang cluster, and `data-pagefind-ignore`
on the content region.

Every one of those five clauses exists to undo a consequence of emitting the
page at all. That is the tell. Not emitting it satisfies all five for free,
and the arithmetic settles it: with one page translated, the fallback design
puts 27 near-byte-identical English copies under `<html lang="ja">` into the
tree — and the shell is built more than once, so the real figure is 27 times
the number of locale-enabled builds.

So `/ja/` contains only real translations, and links to them. The three
states survive, but *missing* now means "this URL does not exist" rather than
"this URL exists and apologises". The design's version is right for a
*mostly* translated site, where every URL resolving matters more than a few
duplicates; it is wrong at the start, which is where every site begins.

Two more things the build settled that the document left implicit:

- **The build guard is the port, not the base.** `[...slug].astro` runs in
  every shell build, so a guard is needed or `/py/stable/ja/concepts/` exists.
  Gating on `base === '/'` as well looks equivalent and silently breaks PR
  previews, which mount the whole site at `/pr-42/` with no port — the one
  build whose whole job is showing a change, including a new translation.
- **hreflang must be built from the unprefixed path.** Deriving alternates
  from the current canonical, as `Seo.astro` originally did, yields
  `/ja/ja/concepts/` the moment a page is already prefixed. The props now
  carry `sourcePath`, and alternates are emitted only when more than one
  locale genuinely has the page.

The staleness check is the part worth keeping. A translation declares the sha
of the English source it was made from; the next commit to that source moves
it to `stale` with nobody remembering to. Verified by moving the sha and
rebuilding, not by reading the code. It is also the only honest way to ship
machine translation: the one Japanese page here carries `reviewed: false` and
says so, in Japanese, on the page.
