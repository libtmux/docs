# Roadmap

Fix five infrastructure bugs now, independent of architecture. Then port the working
Astro shell from `~/work/typescript/social-embed`, land Python plus two more languages,
and only then build out the remaining five languages, versioning, and search.
Translations and the optional cross-language API model come last. The
recommendation-vs-Thin-Shell trade-off (ledger `00-DECISIONS.md` §5) must be decided
before Phase 1 starts — it changes what two of that phase's three languages build.

## Phase 0 — fix now, regardless of architecture

None of these five items depends on Starlight, owned Astro, or any of the four scored
proposals. They are bugs in what exists today, found by running the tools rather than
reading their changelogs, and all five are worth a solo maintainer's next free afternoon.

1. **Scope `aws s3 sync --delete` to a prefix.** `.github/workflows/docs.yml` runs
   `aws s3 sync docs/_build/html "s3://${LIBTMUX_DOCS_BUCKET}" --delete` against the
   bucket root. The moment a second repo publishes into the same bucket unmodified, its
   first deploy erases Python's output.

   ```console
   $ aws s3 sync docs/_build/html \
       "s3://${LIBTMUX_DOCS_BUCKET}/py/" \
       --delete \
       --follow-symlinks
   ```

2. **Set `html_baseurl`.** Unset in both `~/work/python/libtmux/docs/conf.py` and
   gp-sphinx's `config.py`, so Sphinx emits no `<link rel="canonical">` today — not
   wrong, absent. Set it to the current production URL now; Phase 1 updates it again to
   `libtmux.org/py/stable/`.
3. **Template the hardcoded absolute URLs out of `docs/manifest.json` and
   `_templates/page.html`.** `manifest.json`'s `"Scope"` and `"start_url"` are literal
   `https://libtmux.git-pull.com/` strings; a Jinja variable driven by `html_baseurl`
   fixes both. Same audit, same sitting: `redirects.txt`'s 50+ rediraffe entries and
   `conf.py`'s announcement banner, which links `/migration.html` root-absolute.
4. **Fix `sphinx-gp-llms`'s Markdown twins to render the resolved doctree, not copy
   source.** `_md_twins.py` does `shutil.copy2(source_path, target)`; for an autodoc
   page — `docs/api/libtmux.pane.md`, the `Pane` reference page — the "source" is a
   seven-line `.. autoclass::` directive with no docstrings, no members. The `.md` twin
   readers most want is exactly that stub. Write from the post-autodoc doctree (a
   Markdown-writer builder run at `build-finished`) instead. Live bug today, independent
   of the new site — fix it before this copy-not-render mistake reaches seven more
   generators' `.md`-twin support.
5. **Point `libtmux.org` DNS somewhere.** Registered on Cloudflare with no records —
   not misconfigured, empty. Create a placeholder now (a redirect to
   `libtmux.git-pull.com`, or a "coming soon" page) so it isn't fully dark while Phase 1
   builds the real CloudFront distribution.

**Effort:** half a day total, no dependencies on each other or on the phases below.

## Decision gate: recommendation vs. Thin Shell

Ledger §5 names this as the one call the research cannot make. It has to be made before
Phase 1, not deferred to Phase 2, because it decides what two of Phase 1's three
languages actually build:

| | Recommendation | Thin Shell fallback |
|---|---|---|
| Rust | rustdoc skinned, self-hosted `/rs/` | deep-link to docs.rs, badge only |
| Go | doc2go `-embed`, self-hosted `/go/` | deep-link to pkg.go.dev, badge only |
| Java/Kotlin | Dokka skinned, self-hosted | deep-link to javadoc.io |
| Deletes | nothing | those 3 languages' CI, skin work, the CloudFront KVS |

TypeScript, .NET, and the C++ Breathe bridge are unaffected either way. Take the
fallback if maintenance time is the binding constraint, the recommendation if "one
site, one identity" is the goal. This roadmap assumes the recommendation
(`00-DECISIONS.md` §1) — under the fallback, Phase 1 steps 8-9 become badges and links.

A second, smaller gate sits inside Phase 2: ship TypeScript's Astro renderer as a
hand-built page design from the start, or let `api-documenter`'s stock fragmented
Markdown (ledger §7.9 — usable as a stopgap, poor as a permanent design) buy time as an
interim `/ts/`. Either is defensible; decide it when Phase 2 starts, not now.

## Phase 1 — port the shell, then Python + two languages

**Deliverable:** a working `libtmux.org`, serving the shell chrome plus three languages
at single-version, no-i18n, no-KVS simplicity — the minimum that proves the pipeline
shape end to end. Full shell technical detail is `24-astro-shell.md`; this is sequencing.

**Tasks:**

1. Port `~/work/typescript/social-embed/packages/site` into a new `libtmux-org` site
   package: `BaseLayout.astro`, `MarkdownLayout.astro`, `CoreHeaderLayout.astro` and its
   `Pure*` children, `Sidebar`/`SidebarSection`/`TableOfContents`/`Mobile*`, the MDX
   component set, `plugins/astro-pagefind-integration.ts` verbatim, and
   `content.config.ts`'s `glob()` + `z.looseObject` pattern. This is a copy-and-adapt
   job, not a design job — the shell is solved.
2. Replace `PurePackageNav`'s `wc`/`lib` package switcher with a language switcher
   (`/py/`, `/rs/`, `/go/`, growing to eight).
3. Decide the dark-mode `localStorage` key (ledger §7.13) while the shim is being
   copied, not after: migrate `social-embed` to a neutral key, have the shared shim read
   both `starlight-theme` and a new key, or accept per-site keys. Any of the three is
   fine; picking none of them is not — it is the cheapest moment to decide.
4. Stand up `s3://libtmux-docs` (ledger §7.3 — keep the existing `LIBTMUX_DOCS_BUCKET`
   secret name) + CloudFront + OAC + one directory-index CloudFront Function. No
   KeyValueStore yet — single default version per language needs no alias redirect.
5. Build the CloudFront custom-error-response 404 page now (ledger §7.10 gap 1): OAC
   against the S3 REST endpoint returns a raw `AccessDenied` XML body on a miss, not a
   styled page. Remap 403→404 and serve a chosen document — same CloudFront-config
   sitting as step 4.
6. Write the cross-generator shell smoke test (ledger §7.10 gap 3) against these three
   languages while there are only three to check: a CI assertion that the shared header,
   footer, switcher and dark-mode shim actually mounted. Extend per language after.
7. Migrate Python (already Sphinx + `sphinx-gp-theme`, zero new prose) to
   `/py/latest/api/`; this finishes Phase 0's `html_baseurl` fix with its real value.
8. Rust via rustdoc `--extend-css` / `--html-before-content` to `/rs/latest/api/` — the
   lowest-effort real skin, proving the injection pattern before harder tier-2 languages
   in Phase 2.
9. Go via doc2go `-embed` to `/go/latest/api/`. `-embed` emits body-only HTML fragments;
   under an owned shell that is exactly what a hand-written page component wants to wrap
   (ledger §7.2) — a better fit here than under any framework-owned shell.
10. Load the shared header, footer, tokens and switcher at runtime from a stable URL
    (ledger §6), not baked per build, so a chrome fix reaches published output with no
    rebuild. Wire one reusable deploy workflow, invoked per repo with its own prefix
    input, `concurrency: {group, queue: max}` (ledger §7.6 — incompatible with
    `cancel-in-progress: true`), with S3 conditional PUT only as a backstop.

**Blocking dependencies:** the recommendation-vs-Thin-Shell gate must be resolved first
— it decides whether steps 8-9 are self-hosted builds or a badge and a link.

**Effort:** about one month, matching all four scored proposals' Phase 1 estimate.
Porting the shell is roughly a week — copy, rename, restyle, a solved problem. The rest
is AWS infra, Python's URL-scheme migration, and two real skin-injection pipelines.
"We already have the shell" does not mean "we already have the pipeline."

## Phase 2 — remaining languages, versioning, search

**Deliverable:** all eight languages live, real per-tag immutable versioning plus
`/stable/`/`/latest/` as genuine separate builds (ledger §2.3) for every language now
published, and a merged Pagefind index across all of them.

**Tasks, sequenced cheapest/most-native first:**

1. **C++** — Doxygen `GENERATE_XML=YES`/`GENERATE_HTML=NO` → Breathe → Sphinx, same
   theme as Python. Cost is ~26-27 stub pages and Doxyfile macro expansion, not design.
2. **Java/Kotlin** — Dokka HTML, skinned via `customStyleSheets`/`templatesDir`.
3. **TypeScript** — the hand-built Astro renderer against api-extractor's JSON model,
   resolving the decision-gate stopgap above. TypeDoc stays a hard blocker throughout
   (TypeStrong/TypeDoc#3098, below); nothing here waits on it.
4. **.NET** — the hand-built Astro renderer against `docfx metadata` YAML. Same renderer
   tier as TypeScript; budget it comparably, not as a lighter lift.
5. **Swift** — DocC skinned via `theme-settings.json` and `header.html`/`footer.html`,
   sequenced last deliberately: worst uniformity payoff (color-only, no shared chrome),
   and the only generator whose base path is baked absolute, so every alias tier is a
   full rebuild.
6. Real versioning for every live language: `versions.json` manifest, build-per-tag
   plus separate `/stable/`/`/latest/` builds, the CloudFront KeyValueStore, and the
   bare-language-root redirect (`/py` → 302 → `/py/stable/`). Python and C++ can lean on
   `sphinx-multiversion` as-is — not blocking today under gp-sphinx's `sphinx>=8.1,<9`
   pin — but see the PR #202 risk below before raising that pin.
7. Merge Pagefind indexes (`mergeIndex`) across live languages. Go's `-embed` output
   loses doc2go's own bundled search (`flags.go:187-191` hard-errors `-embed`+
   `-pagefind` together), but the merged index is unaffected: the fragment is wrapped
   into a real page with real text before Pagefind crawls it.
8. Decide the immutable-tag rollback story (ledger §7.10 gap 2) once a real tag exists
   beyond Python/Rust/Go — the first point this isn't hypothetical.
9. Ship `/third-party-notices/` with a footer link (ledger §7.10 gap 4) once Dokka's,
   doc2go's, and swift-docc/-render's retention obligations are all known.
10. Close both open IA questions (ledger §7.10 gap 5) before this phase ends: whether
    guide prose is translatable (gates Phase 3's scope) and whether `/py/` is canonical
    or a landing page pointing at `libtmux.git-pull.com`.

**Blocking dependencies:** the five languages are independent of each other, blocked only
on Phase 1's shell and infra. Task 6 (versioning) blocks on any one of them publishing a
second tag — it can land alongside whichever finishes first, not after all five.

**Effort:** 2-3 months solo. TypeScript and .NET are the largest items — ground-up
renderers against a JSON/YAML model, not template configuration — and either can run
long if the decision-gate stopgap is skipped for the full design from day one.

## Phase 3 — translations, and the API model as an optional layer

**Deliverable:** Weblate-wired i18n for shell prose only, at the locale-outermost URL
shape ledger §3 already chose (`/ja/concepts/panes/`, never `/py/v0.46/ja/`); the
cross-language API model (LAM) built only if its own usage bar is cleared.

**Tasks:**

1. Wire Weblate for shell content — concepts, guides, examples, the parity page — with
   one pilot locale. Reference content stays untranslated by design: translating eight
   ports' doc comments isn't workload a solo maintainer takes on. Sphinx's gettext can
   extract autodoc docstrings, but those `.po` entries stay unfilled, for consistency.
2. Generate `hreflang` alternates and per-locale sitemaps — simpler than usual, since
   the locale is one leading segment, not buried inside a version path.
3. Ship a cheap `/parity/` aggregator, if it hasn't landed already in Phase 1 or 2: a
   per-language adapter (a day or two each) that reads each port's *existing* ledger
   file as-is — .NET's two JSON files, Go's `manifest.json`, Java's Markdown table,
   Rust's and C++'s prose, Swift's five JSON files — into one static table, labeling
   provenance per cell rather than presenting them as equivalent. The counts genuinely
   disagree across ports on what a "status" field means (ledger §7.8); do not paper
   over that in the aggregator.
4. **Gate the full LAM schema on real usage of that cheap aggregator**, not a calendar
   date. If usage justifies it and there is 6-12 months of bandwidth, build LAM
   incrementally, cheapest and most certain first: Swift (symbolgraph, 3-5 days),
   TypeScript (api-extractor walk, 3-5 days), .NET (docfx walk plus its existing ledger,
   4-6 days), then Go and Rust (genuinely new extractors), then Java (bounded via a
   javadoc doclet). Spike Kotlin last and separately — the one honest exception with no
   real machine-readable extractor, explicitly allowed to ship late or not at all rather
   than block the other seven. LAM pages are additive tabs linking to each language's
   canonical reference; they never re-host it.

**Blocking dependencies:** Phase 2's "is guide prose translatable" IA question must
close before task 1. LAM (task 4) blocks on the aggregator (task 3) showing real usage.

**Effort:** the Weblate wiring and sitemap work is 2-4 weeks of engineering; translation
labor belongs to translators, not this estimate. LAM in full is its own multi-month
project — the design proposal that specified it costs the complete build at 14-20 weeks
solo plus an indefinite quarterly maintenance tax. That is the honest price of the
optional layer, not a rounding error on Phase 3's translation work.

## Tracked risks and their trigger conditions

| Risk | Trigger | Response |
|---|---|---|
| TypeDoc unusable (TypeStrong/TypeDoc#3098) | Issue closes with a real fix | Re-evaluate whether TypeDoc could replace part of the hand-built TS renderer. Do not block on it — api-extractor's JSON never depended on it closing. |
| `sphinx-multiversion` breaks on Sphinx 9 | gp-sphinx's `pyproject.toml` raises its `sphinx` pin past `<9` | Vendor PR #202 (16 lines, verified working, unmerged 8 months) in the same change that raises the pin, not as a follow-up. Issue #203 ("is this maintained?") is unanswered — expect to carry the patch indefinitely. |
| DocC's `--experimental-enable-custom-templates` is unstable, undocumented | Any Swift toolchain or `swift-docc-plugin` bump | Re-test the header/footer `customElements.define()` mount and the `-with-content` noscript embedding. Pin the exact plugin version in CI. |
| doc2go loses native search in `-embed` mode | Already true (`flags.go:187-191` hard-errors `-embed`+`-pagefind`) | No action — the site-wide Pagefind crawl still indexes `-embed`'s real-text fragments. Revisit only if doc2go reconciles the two flags itself. |

`starlight-versions` is deleted from this list — it tracked a risk that existed only
because Starlight was the shell. Versioning is now our own build-per-prefix loop plus
`versions.json` and a switcher we write once (ledger §7.12); there is no plugin to go
stale.

## Owners for the ledger's five §7.10 gaps

All five now have a phase and a task, not just a name: the 404 page and smoke test land
in Phase 1 (steps 5, 6) while only three languages need wiring; the rollback story and
NOTICE page land in Phase 2 (steps 8, 9), once real tags and all eight generators'
license obligations exist; both IA questions close by Phase 2's end (step 10), since
translatability gates Phase 3's scope directly. None blocks the architecture — all five
were unowned, and now aren't.

The dark-mode `localStorage` key (ledger §7.13) belongs on this list too, though it's a
decision rather than a gap: three named options, none picked. Decide it in Phase 1,
step 3, while the shell is being copied and the key is cheapest to change.
