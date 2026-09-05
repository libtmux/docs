# Architecture options

Four candidate architectures for libtmux.org were scored by three independent judge
lenses. The totals were a near-coin-flip — 19.0 to 18.5 between the top two — and the
winner, **Astro Shell + Native Tier2**, took second place on every lens rather than
first place on any single one. **Thin Shell, Native Reference, Shared Skin** won two of
the three lenses outright and is the documented fallback if solo-maintainer effort
becomes the binding constraint. This document presents all four proposals on their own
terms, the judges' verdicts, and why `00-DECISIONS.md` grafted pieces from three of the
four losers rather than adopting any single proposal whole.

All four proposals were drafted assuming Astro Starlight as the shell. That was reversed
after scoring — see the final section — but doesn't touch the axis these proposals
actually differed on, so the scores below stand unchanged.

## What all four agree on

Every proposal converged on the same base decisions, which is why the judges never had
to score them separately: one S3 bucket behind one CloudFront distribution with Origin
Access Control; one domain, path-prefixed, never subdomains; `/stable/` and `/latest/`
as real, separate builds rather than a CDN rewrite of identical bytes, since canonical
tags bake absolute URLs regardless of link relativity; every `s3 sync --delete` scoped
to its own prefix, never the bucket root; `concurrency: {group, queue: max}` with S3
conditional `PUT` as a backstop; Weblate for translation; generated reference
English-only everywhere, by policy.

The axis the four proposals differ on is **who renders each language's API reference,
and who hosts the result** — native tools skinned in place, everything routed through
Sphinx, three languages deep-linked to ecosystem hosts, or a comparison layer bolted on
top of whichever of the other three wins.

## Proposal 1 — Astro Shell + Native Tier2

**Core bet.** The shell owns exactly four things — prose, search, i18n, one
version-switcher script — and touches nothing else. Every language's reference is built
by its own native toolchain, skinned only through that tool's official CSS/header hook.
The wager: a solo maintainer cannot afford eight custom renderers against eight
uncontrolled upstreams, so brand-perfect uniformity is traded for near-zero rendering
code.

```
libtmux.org/                    shell prose, English
libtmux.org/ja/concepts/        shell prose, localized
libtmux.org/{lang}/{version}/api/    reference, no locale segment, ever
```

| Language | Renders via | Tier |
|---|---|---|
| Python, C++ | Sphinx + `sphinx-gp-theme` (unchanged) | native, IS the design system |
| TypeScript | api-extractor → api-documenter Markdown, satellite Astro build | shell-native |
| Go | doc2go + a forked template patch (no official override hook) | tier2, via a fork |
| Rust, Java/Kotlin, .NET | rustdoc / Dokka / docfx, skinned via native flags | tier2, skin-injection |
| Swift | swift-docc, scored 3/10 for "no injection point" | tier2, claimed outlier |

**Uniformity.** Python/C++/TypeScript at 9–10/10; Rust and Java/Kotlin at 7/10 — matched
header/footer and ~15–20 color variables over each tool's own sidebar and search box;
Go at 6/10, gated on an ongoing fork rebase; .NET at 6/10, vulnerable to a Sass-compiled
core drifting under a color-only override; Swift at 3/10 **on a claim the ledger
refuted** — `header.html`/`footer.html` injection is real (§7.1), so Swift's true score
reads meaningfully higher.

**Build effort.** Phase 1 (~4 weeks): infra, shell, Python relocated as-is, Rust and
unforked Go. Full 8-language build, all skin adapters: 8–12 weeks, excluding i18n.

**Strongest self-objection.** Tony asked for one site because libtmux's selling point is
cross-language parity, and this design ships a `/parity/` page inviting side-by-side
comparison, then sends the reader into eight trees with materially different
information architecture — "ecosystem familiarity" is the wrong frame for that reader.
Second, "near-zero rendering code" undersells five small, brittle integration surfaces
against uncontrolled upstreams: rustdoc's own docs warn `--extend-css` "might break if
the rustdoc's generated HTML changes," and the Go fork must be rebased on every doc2go
release or CI silently ships unskinned docs.

**Ledger corrections.** Swift's 3/10 is wrong (§7.1). Go now uses doc2go's `-embed`
mode, not a rebase-forever template fork (§7.2). api-documenter, run for real against
936 KB of `index.api.json`, fragmented ~13 exports into hundreds of files — a stopgap
(§7.9). .NET goes through `docfx metadata` YAML into a hand-built renderer, not
`docfx build`'s stock HTML (§1).

## Proposal 2 — Thin Shell, Native Reference, Shared Skin

**Core bet.** Prose is genuinely one problem regardless of language and belongs in one
shell with one skin, one search index, one i18n pipeline. Generated reference is *not*
one problem — it's eight toolchains, three of which already get exactly-right,
continuously-maintained hosting from someone else. Where an ecosystem host is strictly
better, link to it and build nothing; elsewhere, self-host with the shared skin.

```
libtmux.org/{concepts,parity,examples}/         shell-owned, evergreen
libtmux.org/{lang}/                              per-language hub page
libtmux.org/{py,cxx,ts,dotnet,swift}/{version}/api/    self-hosted, own CI
docs.rs/libtmux/latest/libtmux/                  Rust, deep-linked
pkg.go.dev/github.com/libtmux/libtmux-go         Go, deep-linked
javadoc.io/doc/org.libtmux/libtmux/latest/       Java/Kotlin, deep-linked
```

| Language | Renders via | Host |
|---|---|---|
| Python, C++ | Sphinx + `sphinx-gp-theme`, Breathe for C++ | self-hosted, own CI |
| TypeScript, .NET | api-extractor JSON / docfx YAML → custom renderer | self-hosted, bespoke |
| Swift | swift-docc, skin-injected | self-hosted, own CI |
| Rust | rustdoc, `[package.metadata.docs.rs]` matches the skin | deep-linked, docs.rs |
| Go | native, zero configuration | deep-linked, pkg.go.dev |
| Java/Kotlin | Dokka `-javadoc.jar`, already required for Maven Central | deep-linked, javadoc.io |

**Uniformity.** 7/10 on shell-owned surfaces, roughly 5/10 across the full reader
journey. Python is Sphinx-rendered, not shell-rendered, so its layout differs from the
other seven languages' guide sections even on shared tokens. Three languages' reference
carries zero visual continuity with the rest of the site — Rust gets token-matching on
docs.rs (mildest case), Go and Java get nothing, and none of the three is indexed by the
shell's own search.

**Build effort.** 14–18 weeks: shell and token port, a content-ingestion cron, infra, a
`/parity/` normalizer reconciling four divergent ledger formats (independently flagged
multi-week on its own), the TypeScript and .NET renderers, Swift's skin, and one-time
deep-link wiring for the other three.

**Strongest self-objection.** This design quietly abandons the project's own premise.
For three languages — possibly Rust and Go, the ports most likely to adopt a tmux
automation library at scale — reference content lives on a foreign domain with foreign
chrome and no shared search. A reader running the "same task, eight ways" comparison
this project exists to enable opens three tabs that look nothing alike, and an outage or
a yanked-and-republished crate on a host this project doesn't control has no fallback.

**Ledger corrections.** The vendored `sphinx-contrib/multiversion` fork is described as
immediately necessary; it isn't blocking today since `gp-sphinx` pins `sphinx<9` (§2.4).
Swift's header/footer is described as needing hand-written custom-element shells; a
plain HTML fragment suffices, since `docc convert` writes the `<template>` wrapper and
`customElements.define()` call for you (§7.1).

## Proposal 3 — The Unified Doctree (Sphinx-maximalist)

**Core bet.** Bet everything on the asset already proven in production —
`sphinx-gp-theme` + `gp-furo-tokens`, live today at `libtmux.git-pull.com`. Any language
whose generator can be coerced into structured data gets a purpose-built bridge feeding
that data through Sphinx's own toctree pipeline as MyST, inheriting the theme, version
switcher, `sphinx-intl` and Pagefind for free. That reaches five ports plus root; the
remaining three (Rust, Java/Kotlin, Swift) get tier2 CSS-token injection.

```
libtmux.org/<port>/<locale>/<version-or-alias>/<page>
libtmux.org/py/en/v0.46.2/api/session.html
libtmux.org/concepts/sessions/       root, unversioned
```

Locale sits outside version but inside the language prefix, reasoned from Sphinx's own
native default rather than a router constraint.

| Language | Bridge | Tier |
|---|---|---|
| Python | native Sphinx autodoc | tier1-native |
| C++ | Doxygen XML → Breathe → Sphinx | tier1-bridge |
| Go | gomarkdoc → new `sphinx-gp-godoc` → MyST | tier1-bridge, new |
| TypeScript | api-extractor → new `sphinx-gp-tsapi` → MyST | tier1-bridge, largest new |
| .NET | docfx YAML → new `sphinx-gp-docfx` → MyST | tier1-bridge, new |
| Rust, Java/Kotlin, Swift | rustdoc / Dokka / DocC, CSS-token skin | tier2-skin-inject |

**Uniformity.** 7/10 overall. Six of nine sections are literally the same Sphinx theme
rendering the same partials — the closest any proposal gets to chrome-identical pages —
and the only one that closes Swift's chrome gap, via a swift-docc-render fork for
`header.html`/`footer.html`. The uniformity judge flagged a gap left unaddressed: "6/9
identical" is verified only at the chrome level. Python and C++ render through genuine
Sphinx domains with structured signatures; the three MyST-bridge languages have no
shared directive convention specified, so their bodies could read as plain headings and
code fences beside Python's.

**Build effort.** 14–18 weeks. Largest items: the from-scratch `sphinx-gp-tsapi`
renderer ("no existing tool does this anywhere") and a new, unverified multiversion
pre-build hook synthesizing each bridge language's content from a ref's non-Sphinx
source before `sphinx-build` runs ("the least-certain estimate in this list").

**Strongest self-objection.** The marquee "old content, current theme, for free"
mechanism is proven for exactly one case — Python's `import` against a git-archived old
tree. It has never been shown to generalize to the four bridge languages, whose content
must be synthesized by running today's tooling against each ref's checked-out source —
an interception hook this research never confirmed multiversion supports. The design
also permanently maintains three bespoke schema-to-MyST renderers with no OSS precedent,
plus a fork of gomarkdoc — three-plus years abandoned upstream — as load-bearing
infrastructure.

**Ledger corrections.** Go's gomarkdoc bridge is superseded by doc2go, since gomarkdoc's
raw anchors break a Sphinx `-W` build with 3,833 warnings and it's been dead since
2023-08-19 (§1). Swift's fix here requires forking swift-docc-render's dist; the ledger
finds the mechanism works from a plain catalog file, no fork needed (§7.1). The
locale-inside-language-prefix scheme for reference URLs is superseded — the adopted
scheme places no locale segment on any reference path (§3).

## Proposal 4 — libtmux API Model (LAM)

**Core bet.** Six of eight ports have already independently built a Python-symbol-keyed
parity ledger, in at least four incompatible shapes that disagree on symbol counts and
what "status" means. LAM's bet: a single schema doesn't add a burden these ports don't
already carry ad hoc — it standardizes one and stops a ninth port inventing format five.
This is explicitly additive: tabs link out to each language's canonical reference, never
re-hosting it.

```
libtmux.org/api/{entity}/            canonical entity page, per-language tab strip
libtmux.org/api/{entity}/{member}/   canonical member page
libtmux.org/parity/                  full entity × language matrix
libtmux.org/parity/{entity}/         per-entity detail, provenance-labeled cells
```

**Per-language.** Nine separate extractors, most brand-new and bypassing existing
tooling: Python (AST + runtime introspection, from Java's own 889-symbol work); Swift
(`symbolgraph-extract`, cheapest of the eight); TypeScript and .NET (reuse existing
extractor output); Go (a new `go/ast` walker, bypassing gomarkdoc's lossy Markdown); Rust
(rustdoc JSON via the unofficial `RUSTC_BOOTSTRAP=1` escape hatch, whose format churned
57→61 in six weeks); Java (a custom doclet, bounded); C++ (raw Doxygen XML, inheriting
Breathe's own gap on C++20 concepts); Kotlin — no published external API into Dokka's
model, self-described as "unbounded... may not ship on schedule."

**Uniformity.** Split rating: the new comparison surface is 9/10, genuinely
Pulumi/Stripe-grade — but every "view full docs" link lands on whatever the base
architecture's reference pages already look like; the proposal's own honest number for
that unchanged experience is 5–6/10.

**Build effort.** 14–20 weeks for a first cut across all eight, plus an admitted 2–4
days per quarter of normalizer firefighting, indefinitely — 6–12 months of calendar time
at a realistic part-time pace.

**Strongest self-objection.** Which Go function is "the same concept" as which Python
method is a human-judgment problem no schema can automate. Worse, the *status* fields
across the six ledgers don't mean the same thing: Java's marks all 1,454 rows "planned
parity" and says the named tests "do not exist," while .NET's marks verified rows
`"implemented"` — a naive merge renders both as the same green cell, actively wrong
rather than incomplete. A cheap aggregator captures roughly 80% of the
parity-visibility value for 10% of full LAM's cost; LAM's real value is a better
per-symbol browsing experience, not a free matrix.

**Ledger corrections.** The proposal's locale-inside-version URL note is superseded by
the adopted no-locale-on-reference scheme (§3). Its "1,454 rows all planned" figure for
the Java ledger is one of two unreconciled counts flagged unverified — prefer the
889-symbol reading from opening the actual file, but treat neither as settled (§7.8).

## The judge panel

Three judges scored the four proposals 0–10 on three lenses: solo-maintainer
sustainability, design uniformity (does a visitor moving `/py/` → `/rs/` → `/swift/`
perceive one site), and operational/delivery risk (blast radius per language).

| Proposal | Solo-maintainer | Uniformity | Ops risk | Total |
|---|---|---|---|---|
| Astro Shell + Native Tier2 | 6.5 | 5 | 7.5 | **19.0** |
| Thin Shell, Native Ref, Shared Skin | 8 | 2 | 8.5 | 18.5 |
| The Unified Doctree | 4 | 7 | 3 | 14.0 |
| libtmux API Model | 3 | 4 | 6 | 13.0 |

**Solo-maintainer sustainability** ranked Thin Shell first, Astro Shell a close second,
Unified Doctree third, LAM last. Thin Shell wins for eliminating entire integration
surfaces: Rust, Go and Java get zero owned code, forever. Astro Shell needs no
from-scratch schema renderer anywhere. Unified Doctree's fatal flaw: its versioning
trick is proven for one of five Sphinx-rendered languages and unverified for the other
four, plus a fork of an abandoned upstream (gomarkdoc) as permanent infrastructure.
LAM's: nine new extractors, one unbounded, layered on top of whichever base architecture
wins.

**Design uniformity** inverted that order — Unified Doctree, Astro Shell, LAM, Thin
Shell last — because Tony's stated goal was "one static docs site... with uniform
design," and this lens judged closeness to that ask rather than whether it should be
redefined away. Astro Shell's fatal flaw here — the erroneous Swift score — is corrected
above. LAM scored low structurally: it doesn't touch per-language uniformity by design.
Thin Shell placed last: "two languages living on unrelated third-party websites is close
to a direct failure of the ask, however defensible the trade-off may be."

**Operational and delivery risk** put Thin Shell first "decisively" (Astro Shell second,
LAM third), for minimizing owned CI to zero pipelines for three languages, and Unified
Doctree last, as the proposal that "bakes shared chrome into every immutable historical
build... while betting its entire critical path on an explicitly unverified
multiversion extension hook."

## Why the synthesis, not any single proposal

Reading the verdicts together explains the coin-flip total better than the totals alone:
**Astro Shell finished second on all three lenses and last on none. Thin Shell finished
first on two and last on the third.** A minimax reading — avoid the worst outcome rather
than chase the best average — favors the proposal with no last-place finish. The
ledger's own framing: "do not read 19.0 vs 18.5 as decisive — it is a coin flip."

Two further arguments carried weight. **Thin Shell is a self-admitted retreat from the
stated goal**, and the judge panel said so explicitly: it sends Go and Java to hosts
with different domains and fonts, nothing to style later since those hosts aren't
controlled. It's the correct fallback if effort becomes binding, not a design that
quietly meets the uniform-design ask while claiming to. **Astro Shell's weakest score
rests on a false premise** — Swift 3/10, from a claim the ledger's source read refutes
(§7.1). Corrected, its uniformity case improves.

Not every judge graft made the recommendation. **Adopted:** runtime-loaded
header/footer/switcher/tokens so chrome fixes reach immutable versions with zero rebuild
(§6); real separate `stable`/`latest` builds (§2.3); prefix-scoped `s3 sync --delete`
(§6); `concurrency: {queue: max}` with S3 conditional PUT as backstop (§6); doc2go over
gomarkdoc (§1); demoting `sphinx-contrib/multiversion` to optional backfill (§2.4);
Swift's corrected chrome hook (§7.1); and a provenance-labeled status distinction for
parity data so mismatched ledger semantics never render as a falsely uniform matrix —
LAM's sharpest idea, worth having regardless of whether LAM ships. **Not adopted:**
dropping the KeyValueStore entirely — kept, scoped to the bare-language-root redirect,
since the chosen topology still has a redirect to resolve where Thin Shell's hub pages
didn't (§2.3). Unified Doctree's reusable CI workflow was skipped too — each port repo
owns its own CI (§7.7).

## What the fallback actually deletes

`00-DECISIONS.md` §5 corrects a claim an earlier draft got wrong. Thin Shell's fallback
deletes neither the TypeScript/.NET renderers nor the C++ Breathe bridge — all three
stay bespoke or Sphinx-native even in the fallback. What it deletes is Rust's, Go's and
Java's owned CI, their skin-injection work, and the CloudFront KeyValueStore:

| | Recommendation | Thin Shell fallback |
|---|---|---|
| Languages with owned CI | 8 | 5 |
| Languages sharing a design token | 8 | 6 |
| Languages on a domain you control | 8 | 6 |
| Bespoke renderers | TypeScript, .NET | same two, or stock output instead |
| C++ Breathe bridge | yes | yes |
| CloudFront KeyValueStore | yes | not needed |

The "domain you control" cell does not reconcile against its own itemization — five
languages are self-hosted (Python, C++, TypeScript, .NET, Swift), and Rust lives on
docs.rs — so treat it as unverified pending a re-count.

The fallback reaches a lower renderer count only by using stock `api-documenter`
Markdown and docfx's own stock HTML instead of custom pages — a quality trade, not a
deletion. Take the fallback if maintenance time binds; take the recommendation if "one
site" is genuinely the goal — the ledger is explicit this is the one decision the
research cannot make.

## The shell technology changed after this scoring — it doesn't move the ranking

Every proposal above assumed Astro Starlight as the shell framework. That was reversed
on 2026-09-02: the shell is now an owned Astro site, every layout and component
hand-built, no documentation framework. The reversal came from direct experience —
Starlight was adopted for `social-embed.org` and removed again:
`~/work/typescript/social-embed`'s PR #55, "Migrate from Starlight to pure Astro"
(`09ec34f2`), preceded by `5b1f352a` (`StarlightPage` → `BaseLayout`), `96c8b3f9`
(removing overrides), and `cfabf5ee` (removing the dependencies) — lock-in to someone
else's component API and upgrade cadence.

The research independently supports the conclusion. **Versioning**: zero matches for
"versioning" in a 3,017-line changelog, and `starlight-versions` self-describes as early
development at 99 stars — every proposal above was already building versioning itself.
**Search**: Starlight's "zero config" Pagefind is ~40 lines shelling to the Pagefind CLI
on `astro:build:done`, a pattern `social-embed` already carries verbatim. What is
genuinely lost is Starlight's first-party i18n routing — real but small, and §3's
locale-outermost URL shape now stands on its own merits as a chosen design, not a
router constraint.

None of the three lenses scored the shell framework — they scored renderer ownership,
hosting delegation, chrome-baking, and unverified mechanisms like multiversion's per-ref
hook, all identical regardless of shell. The change does, uniformly, delete the
`starlight-versions` risk from every proposal.

One proposal-specific effect is worth naming. Under Starlight, Astro Shell's TypeScript
lane was pitched as api-extractor → api-documenter → a Starlight satellite build — close
to zero rendering code. Under an owned shell, TypeDoc remains a hard blocker (§2.1) and
api-extractor's JSON has no themable generator to hand off to — the page must be
hand-built directly, exactly as Thin Shell always proposed. Post-change, the
recommendation carries the same two bespoke renderers Thin Shell carried from the start;
the remaining difference collapses to whether Rust, Go and Java get owned CI or a
deep-link — sharpened, not changed, by the swap. The other three proposals are largely
unaffected: Doctree never used a JS shell; LAM already specified Astro's Content Layer
API directly; Thin Shell's "Starlight over Rspress" argument is simply moot.
