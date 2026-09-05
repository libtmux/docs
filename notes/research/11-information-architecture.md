# Information architecture and sitemap

Every real multi-language documentation site examined collapses to the same skeleton:
one unified site with a shared conceptual section, one uniformly-shaped subsection per
language, and cross-language comparison confined to specific leaf pages rather than
spread across the whole site. libtmux.org should copy that skeleton, reserve `/parity/`
and the per-object drill-downs it needs, and accept that both are blocked on real
engineering — a ledger normaliser and a cross-repo example vendor — that this document
names but does not build.

## Patterns from real sites, grouped by mechanism

Eight sites were examined for `cross-ia-prior-art.json` (one cloned, to `~/study/docs/opentelemetry.io`;
the rest live-fetched): OpenTelemetry, gRPC, protobuf.dev, Sentry, Stripe, Pulumi,
Firebase, and the Azure SDK / Kubernetes pair as a cautionary case. They reduce to five
mechanisms, not eight distinct site designs:

| Pattern | Mechanism | Examples | Where it fits libtmux.org |
|---|---|---|---|
| A — unified skeleton | Shared concept section + one uniformly-shaped section per language; generated API reference is an out-link | OpenTelemetry `content/en/docs/languages/<lang>/`, gRPC `/docs/languages/<lang>/`, protobuf.dev `/reference/<lang>/` | The site skeleton |
| B — same-URL tabs | One page, one prose narrative, N language panes behind a client-side chooser, hand-written per language | Stripe API reference, Pulumi get-started tutorials (`<!-- chooser: language -->` markup), Firebase SDK guides | `/examples/<task-slug>/` |
| C — schema-driven reference | Every language's reference block generated from one JSON schema | Pulumi Registry resource docs, citing `/registry/packages/aws/schema.json` | The aspiration for `/parity/`, not yet buildable — libtmux has four incompatible ledger formats, not one schema |
| D — matrix with shared material pulled out | A platform × framework matrix, with API reference and other cross-cutting material kept out of the per-platform tree | Sentry `/platforms/<platform>/guides/<framework>/` | Justifies keeping `/concepts/` and `/parity/` out of each `/<port>/` subtree |
| E — meta-site, real docs elsewhere | Guidelines and a release inventory; the actual reference lives off-site | `azure.github.io/azure-sdk`, Kubernetes client-library table | What libtmux.org must not become — the brief is one uniform design, not a links page |

OpenTelemetry, gRPC, and protobuf.dev are the closest analogues in scale (8-11 languages)
and they are all Pattern A at the skeleton level — none organizes the whole site as
Pattern B/C tabs, and no site examined does. Tabs are always a leaf-page technique
layered on a Pattern-A skeleton. The recommendation is that layering: a Pattern-A
skeleton, Pattern B on `/examples/`, and Pattern C as the long-term target for `/parity/`
once a normaliser exists.

One structural note changes libtmux's shape versus OpenTelemetry's: OTel gives Kotlin its
own top-level `languages/kotlin/` because it is a separate SDK and team. libtmux's Kotlin
support (`libtmux-kotlin`) is a Gradle module inside the single `libtmux-java`
repository — one version, one tag, one release train — so it gets a `/java/` guide
subpage, not a ninth section. The same repo also carries a `docs/guide/scala.md`, so
`/java/` should reserve room for a Scala subpage too: no ninth port, just a language
section with more than one guest language inside it.

## What is shared across all eight ports, and what is not

Direct inspection of all eight repositories confirms five genuinely shared elements,
independent of language:

- **The domain model** — Server > Session > Window > Pane > Client. Every port's own
  architecture document describes the same hierarchy in the same order.
- **Control-mode versus one-shot transport** — every non-Python port ships both a
  persistent `tmux -C` control-mode client and a subprocess-per-command path; the
  tradeoff is the same tradeoff in each language.
- **The query/filter model** — Python's `_internal/query_list.py`, ported as Go's
  generated filters plus `tmuxq`, C#'s `QueryDocument`, and equivalents in every other
  port. This is also the deepest parity surface (see below).
- **Workspace YAML** — a declarative session-layout format, packaged separately in every
  port (`libtmux-ts/packages/workspace`, `libtmux-rs/crates/tmux-workspace`,
  `libtmux-go/workspace`, `libtmux-dotnet/src/LibTmux.Workspace`, etc.).
- **An MCP server** — every non-Python port ships one (`libtmux-ts/packages/mcp`,
  `libtmux-rs/crates/tmux-mcp`, `libtmux-go/mcp`, `libtmux-java/libtmux-mcp`,
  `libtmux-dotnet/src/LibTmux.Mcp`, `libtmux-cxx`'s `apps/mcp` and `tools/mcp`,
  `libtmux-swift/Sources/LibTmuxMCP`).

What is genuinely per-language is idiom translation and failure-handling philosophy, and
the ports document this divergence themselves rather than leaving it implicit. Go's
`PARITY.md` states it directly: "Python signals a degraded result with `warnings.warn`...
Go's equivalent is a return value the caller must be given a reason to read." That is a
documented decision, not a gap, and belongs in the per-port guide, not `/concepts/`.

Each shared element above earns a `/concepts/` page. A sixth, `tmux-versions/`, documents
tmux compatibility policy — versioned by tmux release (the `tmuxVersions` field ports
already record, e.g. `"3.2a-3.7b"`), never by any port's own version. None of these six
need inventing from nothing: Python's `docs/topics/` at
`~/work/python/libtmux/docs/topics/` already has hand-written prose for most —
`architecture.md`, `clients.md`, `filtering.md`, `options_and_hooks.md`, `traversal.md`,
`workspace_setup.md`, and `format-tokens.md` seed the domain-model, query-filter, and
workspace-files pages directly.

## Proposed sitemap

```
libtmux.org/
  /                          landing: port picker + "same task, 8 ways" hero
  /concepts/
    domain-model/            Server > Session > Window > Pane > Client
    transports/              control-mode vs one-shot (subprocess)
    query-filter/            the query/filter model, one tab per port's translation
    workspace-files/         declarative YAML workspace format
    mcp/                     shared MCP tool-surface concept
    tmux-versions/           tmux compatibility policy, versioned by tmux release
  /examples/<task-slug>/     same task in 8 languages, tabbed (see below)
  /parity/                   generated matrix -- blocked on a normaliser (see below)
    <object>/                per-object drill-down, e.g. /parity/query-list/
  /third-party-notices/      NOTICE text for doc2go, Dokka, DocC, docc-render
  /ja/...                    shell prose only, mirrors the tree above

  /py/stable/  /py/v0.46.2/  ...     each a full, separate build:
  /ts/stable/  /ts/v1.4.0/   ...       index (quickstart) · guide/ · api/
  /rs/stable/  ...                     mcp/ · workspace/ · changelog/
  /go/stable/  ...
  /java/stable/ ...                    /java/ guide/ also carries kotlin.md
  /dotnet/stable/ ...                  and scala.md as subpages, not new ports
  /cxx/stable/ ...
  /swift/stable/ ...
```

`/py`, `/ts`, etc. with no version segment 302-redirect to that port's `/stable/` build,
per the ledger's ruling that `/stable/` and `/latest/` are separate builds, never a
rewrite of an already-qualified URL (§2.3). `/concepts/`, `/examples/`, `/parity/`, and
`/third-party-notices/` are unversioned shell pages; only the eight `/<port>/` trees carry
a version segment. The 404 page's ownership (site-wide versus per-language) is a gap the
ledger names in §7.10 item 1 and is not decided here.

## The parity ledger is not a straight join — four files, four shapes

Building `/parity/` looks like one join across eight ports. Reading the actual files at
`~/work/libtmux/libtmux-dotnet/docs/parity/`, `~/work/libtmux/libtmux-go/PARITY.md`,
`~/work/libtmux/libtmux-java/docs/parity/`, and `~/work/libtmux/libtmux-swift/Parity/`
shows four incompatible shapes among just these four ports:

| Port | File | Format | Key shape | Pin | Rows |
|---|---|---|---|---|---|
| .NET | `docs/parity/parity-ledger.json` | JSON array of `rows` | colon path, `pythonSymbolId` | commit `c4a980b` | 626, all `implementationStatus: "implemented"` (verified by direct count) |
| Go | `tmux/internal/parity/manifest.json` | JSON array of `entries` | `libtmux#export:Client`-style id | per-entry `sha256:` digest, plus file-level `source_digests` | 1,588 |
| Java | `docs/parity/python-api.md` | Markdown table, cells wrapped in `<code>` | plain Python dotted name | commit `c4a980b` | 889, its own stated "reconciled symbols" count |
| Swift | `Parity/python-public-api.json` (+ four sibling JSON files) | JSON `entries` under `documentKind: "libtmux.python-parity-manifest"` | `qualifiedName` | `sourceFingerprint` | not counted here — a fifth shape again |

Only .NET and Java share a pin point (`c4a980b`); Go pins per-file by content hash, not
revision; Swift adds a `sourceFingerprint` on top of its own JSON shape. Rust
(`crates/libtmux/docs/parity.md` plus `scripts/check-parity-claims.py`) and C++
(`docs/design/parity-gaps.md`, a design note rather than a generated ledger) each add a
further distinct shape. Go additionally maintains a *third* parity artifact,
`mcp/PARITY.md`, scoped to its MCP subpackage alone — even one port's parity material is
not one file. A `/parity/` page built by literally joining these is not buildable as-is.
It needs a **normaliser** — its own follow-up task, not scoped here — that parses each
port's file into a common `{pythonModule, pythonSymbol, port, portSymbol, status,
evidenceUrl}` row and *surfaces* the pin mismatch on the page itself ("Go: verified
against Python content as of the resolved commit for each digest; .NET/Java: verified
against `c4a980b`; TypeScript: verified against `v0.62.0`") rather than hiding it. That
mismatch is reader-facing information, not a defect to paper over.

**On ledger §7.8's disputed Java row count:** direct inspection resolves "1,454 vs 889" as
two files answering two different questions, not one file counted two ways.
`docs/parity/python-api.md` states "33 modules, 889 reconciled symbols" — a
Python-AST-plus-runtime *symbol* inventory — and grepping its `<code>`-wrapped rows
returns exactly 889. `docs/parity/test-map.md` states "1454 rows," all marked `planned
parity`, derived from a pytest node-ID collection — a *test-case* catalogue, a different
unit entirely, its own header explicit that "nothing here has been ported." Both counts
are internally consistent for the file they describe; the dispute was over which file is
"the Java ledger," not an arithmetic error. The normaliser still must decide which file
(or both) feeds `/parity/` — test-map.md says plainly it is not a status report — but the
counts themselves no longer need re-measuring.

## "Same task, eight languages": the tabbed example page

The Astro shell already has the component for `/examples/<task-slug>/`:
`Tabs.astro` and `TabItem.astro` in `social-embed`'s
`packages/site/src/components/mdx/`. This is content work, not component work — the
`<Tabs syncKey="lang"><TabItem label="Python">...</TabItem>...</Tabs>` markup is exactly
Pattern B from Stripe and Pulumi. One concrete reuse worth calling out: `Tabs.astro`
already persists the selected tab per `syncKey` in `localStorage`
(`tabs-sync-${syncKey}`), read back on mount. Using the same `syncKey="lang"` on every
`/examples/` page means a reader who picks Rust once sees Rust again on the next example
page too, across full page navigations, with no new code — just a naming convention
authors of these pages need to follow. That key is in a separate `tabs-sync-*` namespace
from the theme's `localStorage` key, so it is independent of the still-open dark-mode key
question in ledger §7.13.

**Keeping the tabs honest is the harder half.** libtmux-ts already has doc-verification
machinery for exactly this problem, in `~/work/libtmux/libtmux-ts/scripts/`:

- **`check-doc-runnable.ts`** ties a documented recipe to code that actually runs. A
  fenced ` ```ts ` block immediately preceded by a `<!-- runs: examples/agent.ts -->`
  marker must be sourced from a file under `examples/` that exists; every "significant"
  line of the shown block (trimmed, blank lines and `//`/`*` comments excluded) must then
  appear in that file, in order, as a subsequence — not necessarily contiguous, so the
  README can omit error handling and commentary, but it cannot show a line the executed
  example no longer contains.
- **`check-doc-claims.ts`** checks five further claims, all answerable from the tree: a
  repo-relative path in a `` ```console `` block exists; a package named in an install
  command (`bun add`, `npm install`, `npx`, `pnpm add`, `yarn add`, `bunx`, …) is one this
  workspace actually publishes; a public README's install example pins a prerelease
  package to that package's own manifest version; a tmux compatibility badge states
  exactly the range CI's test matrix runs (`.github/workflows/typescript.yml`'s
  `tmux-version` list); and every published package's README states the same three
  platform-support sentences verbatim (Linux only host tested against real tmux; macOS
  CI checks artifacts only; WSL untested).

Neither script can run as written against libtmux.org's build: both walk `git ls-files
"*.md"` inside the TypeScript repository itself, hardcode the `` ```ts `` fence language,
and resolve `examples/` relative to that repository's root. A shell-side example page
therefore needs two layers, not one:

1. **Port-side (exists today for some ports).** Each port's own checker keeps its own
   docs honest against its own `examples/` and CI matrix, at HEAD. Direct source reading
   finds this in five of eight ports, each built differently: TS (the marker-plus-
   external-file pair above), Rust (native `cargo test --doc`, gated by
   `scripts/check-doctests-run.py`, which fails a doctest whose visible lines are never
   reached rather than blacklisting known-dead shapes), Go (native `Example` functions
   under `go test`, found in `tmuxq`, `mcp`, `workspace`, and `tmux` itself), Python
   (`>>>` doctests embedded in `docs/topics/*.md`, collected by pytest), and Java
   (`docs-tests/`, described by `docs/parity/test-map.md` as "55 tests check every code
   snippet in the documentation"). No equivalent turned up by direct search in .NET,
   C++, or Swift — worth confirming with each maintainer rather than treating as settled,
   since a filename search is not a read of every test file.
2. **Shell-side (new work).** libtmux.org's build must vendor each port's `examples/`
   directory at the exact tag being built — a sparse or shallow checkout in CI, the same
   shape OpenTelemetry uses to mount runnable example apps living outside its docs
   repo — then treat that port's own doc-verification result as a publish gate for its
   tab, rather than re-implementing eight toolchains inside the Astro build.

**The gating rule, stated plainly:** a port's tab in `/examples/<task-slug>/` is blocked
until that port has a mechanism tying its shown code to code that actually runs, and the
shell's build re-checks that mechanism at publish time. That is a property of the
mechanism, not of any one script's filename — Rust's `cargo test --doc` and Go's native
`Example` functions satisfy the same requirement TS's marker pair does, by entirely
different means. `/examples/` can and should ship with fewer than eight tabs at launch
and grow a tab per port as each closes this gap, rather than waiting for all eight.

## Publishable user documentation versus internal dev notes

Every port's repository mixes documentation meant for readers with process artifacts —
spikes, bakeoffs, architecture reviews, decision records — that should never reach
libtmux.org. Direct inspection of each repository's doc tree gives a consistent rule:

| Publishable | Internal — do not ship |
|---|---|
| Per-package `README.md` | `AGENTS.md`, `CLAUDE.md` (always) |
| `docs/guide/*` (getting-started, filtering, streaming, mcp, kotlin, scala, …) | `docs/spikes/`, `dev/Spikes/` |
| `docs/modes/*` (control-mode, one-shot, chaining) | `docs/bakeoffs/`, `docs/decisions/` and their `evidence/` |
| `docs/mcp/`, `mcp/TOOLS.md` | `docs/plans/`, `docs/reviews/` |
| `docs/api*.md`, DocC articles (`Sources/LibTmux/LibTmux.docc/*.md`) | `docs/studies/`, `docs/benchmarks/runs/` |
| `examples/*/README.md` | `attic/` (libtmux-ts already quarantines old spike prose here) |
| `CHANGELOG.md` | |

Two files are borderline, worth a deliberate call rather than a default: Go's
`DESIGN.md`, which `PARITY.md` cites as where per-language divergences are recorded —
semi-public reference, not pure process — and .NET's `docs/public-api.md` and
`docs/quality-bar.md`, which read as contract documents but were not written for an
external audience. Decide these per-file, not by directory-name heuristic.

## Two open questions from ledger §7.10, closed or left open by name

**Is per-port guide prose translatable?** Left open by the ledger; this document derives
a default rather than picking arbitrarily. §3's URL shape puts every `/<port>/` tree at a
version-prefixed path with no locale segment, on the reasoning that a locale nested
inside a version implies per-version translated reference — which is explicitly not the
goal. Per-port guide prose lives inside that same versioned tree
(`/java/v1.x/guide/getting-started/`), so the same reasoning applies to it by
construction: **the default is that per-port guides are English-only, versioned with
their port, and gated by that port's own doc-verification scripts** — the same scripts
described above, which only run against that repository's own tree. Making guide prose
translatable would mean lifting it out of the versioned port tree into the unversioned,
locale-prefixed shell — decoupling it from the port's own release tag and from the
checkers that keep it honest. That is a real option, not a bad one, but it is a
structural change with a cost, and it is Tony's call to make, not a default this document
should assume silently.

**Does `/py/` become canonical, or stay a landing page pointing at
`libtmux.git-pull.com`?** Half of this is already decided: the ledger's own §1 sitemap
lists `libtmux.org/py/v0.46.2/` and `libtmux.org/py/stable/` as real, separate builds
with their own canonical tags — a genuine second copy of the Python reference, not a
landing page. What remains open is only the `libtmux.git-pull.com` side: whether it keeps
serving the same Sphinx output indefinitely, redirects to libtmux.org, or coexists. §2.3's
duplicate-content finding — `doc.rust-lang.org` serves byte-identical content at two
prefixes with no canonical tag on either — argues this needs an explicit answer, not one
that resolves itself. That answer belongs to document 06 (`06-aws-s3-cloudfront.md`) and
to Tony, not to information architecture; this document's job is only to note the IA half
is already settled and not re-litigate it.
