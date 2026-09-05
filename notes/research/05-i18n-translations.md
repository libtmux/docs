# Translations and i18n

Only the Astro shell — the prose we write ourselves — gets translated. The eight
generated API references stay English-only by policy, not by tooling limitation, and
carry no locale segment at all. Locale sits outermost in the URL (`/ja/concepts/`).

The earlier draft picked that shape because Starlight's router only supports a
first-segment locale. That framework constraint is gone; an owned `[...slug]` route can
emit any shape. Locale-outermost stands anyway, now on three merits: it keeps translated
shell and untranslated reference cleanly separated (a locale prefix means "this subtree
is translated," its absence means reference content — a locale buried inside
`/py/v0.46/ja/` would wrongly imply per-version translated reference); `hreflang`
alternates and per-locale sitemaps are simpler to generate from a single leading
segment; and it matches the convention of every multi-locale docs site surveyed,
including OpenTelemetry's default-language-unprefixed Hugo layout.

## What is translatable and what is not

| Content class | Source | Translatable? | Mechanism |
|---|---|---|---|
| Shell chrome (nav, search box, theme toggle, prev/next, 404 text) | hand-written, Astro components | Yes | UI string table, own routing |
| Concepts and guides | hand-written MDX, per-topic, language-port-agnostic | Yes — highest-value target | per-locale content collection |
| Parity pages ("same task in eight languages") | hand-written MDX wrapping untranslated code samples | Prose yes, code fences no | same collection; `Tabs`/`TabItem` content stays as-is |
| Generated API reference (all 8 ports) | doc comments in 8 source repos, run through Sphinx/rustdoc/TypeDoc-successor/Dokka/DocFX/Doxygen/doc2go/DocC | No, by policy | none — English only, no locale segment |

The reference exclusion is a workload decision, not a technical one. Sphinx is the only
toolchain of the eight with a gettext-equivalent extraction step at all, and even there
translating means translating the docstrings in `~/work/python/libtmux`'s source — the
same problem the other seven ports have, one step further down the surface. A solo
maintainer cannot keep 8 repos' doc comments translated in sync with every release;
guide prose churns far slower and is worth the investment instead.

### The Sphinx gettext fact, verified — and why it stays unused

`sphinx-build -b gettext` genuinely extracts `autodoc`-sourced docstrings into the
`.pot` catalog — verified empirically: a throwaway module with a docstring produced a
`.pot` entry with a synthetic source location (`mymod.py:docstring of mymod.hello:1`).
Tracing why, `sphinx/util/nodes.py:229` (`is_translatable()`) accepts any `TextElement`
with `node.source` set, and autodoc's `nested_parse` gives docstring paragraphs exactly
that; `sphinx/builders/gettext.py:180-190` (`I18nBuilder.write_doc`) walks the whole
resolved doctree with no special case excluding autodoc's `desc_content`.

The extraction mechanism is real. What is *not* real, per ledger §3, is any localized
Sphinx build ever being deployed: `/py/*` carries no locale segment, full stop, so there
is no `-D language=ja` build for a `.po` file to feed. Treat this pipeline as two things,
not one:

1. **Proof of the underlying fact** — gettext does not know or care that a paragraph
   came from a docstring, so "leave the API reference untranslated" is a chosen
   exclusion, not a limitation you're stuck with.
2. **A dormant, ready path** — if ledger §7.10 item 5 ("is per-port guide prose
   translatable?") is ever closed toward "yes, and so is Python's reference," the
   `sphinx-intl` pipeline below is the mechanism, unmodified. Until then, no `.po` files
   for the API reference exist, and none should be generated.

## The Sphinx side: sphinx-intl and gettext, for guide prose only

For the Python and C++ ports' any-translated-guide-prose (should that ever be lit up),
the pipeline is standard Sphinx gettext, with four non-default settings worth pinning in
`conf.py` from day one so a later `sphinx-intl update` does not require touching build
plumbing:

```python
locale_dirs = ["locale/"]
gettext_compact = False
gettext_uuid = True
gettext_location = True
gettext_allow_fuzzy_translations = False
```

- `locale_dirs` (`sphinx/config.py:231`, default `['locales']`) — set explicitly to
  `locale/` singular, matching the directory name every doc below assumes.
- `gettext_compact` (`sphinx/builders/gettext.py:335`, default `True`) collapses every
  document under a top-level directory into one `.po` file
  (`api/foo.rst` + `api/bar.rst` → `locale/<lang>/LC_MESSAGES/api.po`). Set it `False`
  for one `.po` per source file — cleaner diffs, and a translator can be assigned a
  single page rather than an entire section's catalog.
- `gettext_uuid` — stable per-string UUIDs in `.po` comments, surviving unrelated
  line-number churn elsewhere in a file.
- `gettext_allow_fuzzy_translations` (`sphinx/config.py:235`, default `False`) — the
  load-bearing setting for a machine-translation-first workflow: any `.po` entry marked
  `#, fuzzy` is skipped at build time and Sphinx renders the English source instead. MT
  suggestion tools, including Weblate's own add-on below, stamp their output `fuzzy`
  automatically, so the default gives MT-first-with-human-gate for free — a human must
  clear the flag before a translated string ships.

Build sequence, three commands:

```console
$ sphinx-build -M gettext . _build/gettext
```

```console
$ sphinx-intl update -p _build/gettext -l ja -l es
```

```console
$ sphinx-build -D language=ja . _build/html/ja
```

`sphinx-intl` also owns `update-txconfig-resources` for a Transifex push/pull cycle, and
names Weblate as the other directly-supported service — both integrate by reading and
writing the same `.po` files, no custom sync code required. Leave
`gettext_additional_targets` (`doc/usage/configuration.rst:668`) empty — it is the opt-in
list for extracting code-block/alt-text content, and code samples should stay untranslated.

**A sitemap bug this pipeline would hit on day one, if lit up:** `sphinx-gp-sitemap`
computes `lang_segment = f"{language}/" if language else ""`, and Sphinx's `language`
config defaults to `'en'`, backfilling only when the value is literally `None`
(`sphinx/config.py:230,573-581`) — an explicit empty string survives. Left at default,
the English build's own sitemap would emit `/en/...` in every `<loc>`, wrong for a build
that is supposed to be unprefixed. Fix by setting `language = ""` for the English build,
or by patching in a `root_language` concept mirroring "unprefixed default locale." File
this against whichever repo owns `sphinx-gp-sitemap` before any Sphinx-side translation
ships.

## The Astro side — built and owned by us

Astro core ships an `i18n` config key (`locales`, `defaultLocale`,
`routing.prefixDefaultLocale`, `routing.fallbackType: 'redirect' | 'rewrite'`, a
top-level `fallback` map, and a `routing: "manual"` escape hatch), confirmed against the
installed Astro types under social-embed's `node_modules/astro`. Real, but not what we
should use.

### Recommendation: hand-roll the routing, skip `astro:i18n`

The shell's existing routing model, ported unchanged from social-embed, is one dynamic
catch-all — `src/pages/[...slug].astro` — resolving every page from a single content
collection at build time (`src/content.config.ts`'s `glob()` loader). Astro's built-in
i18n router assumes the opposite shape: locale-keyed page directories, with middleware
and automatic-redirect machinery operating on the whole project's route manifest.
Bolting it onto a content-collection-driven catch-all buys three things —
`Astro.currentLocale`, `getRelativeLocaleUrl()`, and `routing.fallbackType: 'rewrite'`
(which genuinely renders default-locale content at a missing page's locale URL) — at the
cost of a second, framework-owned routing model beside the one we already have.

That fallback-rewrite feature does not go far enough to justify the coupling: it handles
a missing *page* only. It sets no canonical tag pointing at the English original, does
not exclude the page from that locale's hreflang cluster or sitemap, and renders no
"not yet translated" banner — all of which we write ourselves regardless, since no
framework is left to write them for us. Once that logic is our own code, Astro's
parallel `fallback` config is a second path solving the same problem worse — the
ledger's Starlight lock-in argument (§1.1) one layer down: a config surface owned by
Astro core, bought for behavior that is a few lines of our own `getStaticPaths()` logic.

**What we build instead**, all inside the existing `[...slug].astro` catch-all:

- `src/i18n/locales.ts` — the supported-locale list and the default:

```ts
export const LOCALES = ["en", "ja"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
```

- `src/i18n/ui.ts` — the chrome string table, typed so a missing key across locales
  fails the build instead of silently rendering blank:

```ts
import type { Locale } from "./locales";

export const ui = {
  en: { "nav.search": "Search", "page.editLink": "Edit this page" },
  ja: { "nav.search": "検索", "page.editLink": "このページを編集" },
} satisfies Record<Locale, Record<string, string>>;
```

- A `resolveLocale(slug: string[])` helper: first segment against `LOCALES`, default to
  `en` when absent or unrecognized — the entire routing logic, and the same
  string-prefix check `Sidebar.astro` already uses to scope itself to `/lib/` vs `/wc/`
  (`currentPath.startsWith("/lib/")`), extended one prefix position further.
- A three-state fallback per page, not Astro's two-state one: **translated** (a
  `<locale>/<slug>.mdx` entry exists), **stale** (it exists but its `source_commit`
  frontmatter no longer matches the English source's current commit, checked at build
  time via `git log -1 --format=%H -- <english path>`), or **missing** (falls back to
  the English entry). Stale and missing render distinct banners; only "translated"
  suppresses one. Sphinx's `translation_progress_classes` (7.1+) is the closest existing
  analogue for a completion signal, but it applies to `.po` builds and buys nothing on
  the MDX side — this three-state check is ours to write.
- **Fallback pages are duplicate content and must be marked as such.** A `ja` page
  rendering the English fallback is near-byte-identical to the original. Give it
  `<link rel="canonical" href=".../concepts/panes/">` (the unprefixed English URL),
  exclude it from the `ja` sitemap and from that page's own hreflang cluster (alternates
  must point only at real translations), and mark its content region
  `data-pagefind-ignore` — otherwise Pagefind indexes English prose under
  `<html lang="ja">` with Japanese stemming applied, which is actively wrong.

MDX has no fuzzy flag — that mechanism is `.po`-specific. The Astro-side equivalent of
gated MT review is the `source_commit` staleness check above: newly machine-translated
files stay out of the `translated` state until a human edits them and updates the
frontmatter by hand.

## Directory layout and URL shape

```
libtmux.org/                     shell, English (unprefixed)
libtmux.org/ja/                  shell, Japanese
libtmux.org/ja/concepts/panes/   translated concept page
libtmux.org/concepts/panes/      English concept page (canonical for both)
libtmux.org/py/stable/           Python reference — no locale segment, ever
libtmux.org/ja/py/stable/        does not exist — 404, not a locale-scoped reference
libtmux.org/en/                  does not exist — English is unprefixed, not /en/
```

```
src/content/docs/
  concepts/
    panes.mdx                    English, canonical source
  guides/
    quickstart.mdx
  ja/
    concepts/
      panes.mdx                  Japanese translation, source_commit: <sha>
    guides/
      quickstart.mdx
locale/                          (Python/C++ repos only, dormant until §7.10.5 resolves)
  ja/LC_MESSAGES/*.po
```

One `docs` glob collection, unchanged from social-embed's `content.config.ts` — locale
is derived from the leading `ja/` path segment, the way `Sidebar.astro` already derives
its `lib`/`wc` section from a path prefix. No second collection, no schema fork.

## Locale × version: nearly a non-interaction, and that is the payoff

Under §3, translated content is unversioned (shell prose) and versioned content is
untranslated (API reference); they never share a URL. The interaction is close to null —
a direct benefit of locale-outermost-with-no-reference-translation, not a gap:

- `versions.json` needs no locale field. It describes tag/branch/alias metadata for
  reference builds, which are always English.
- The version switcher, rendered only on reference pages, is version-only. The locale
  switcher, rendered only on shell pages, is locale-only. Neither widget needs to know
  the other exists.
- The one open question is the runtime-injected chrome shared across both (ledger §6:
  header, footer, switcher, and dark-mode shim, loaded at runtime so they can be patched
  without rebuilding an immutable tag). Recommendation: keep it English-only even on a
  reference page reached from a `ja`-shell visit. Reading a stored locale preference to
  re-render Japanese chrome over English reference content adds a runtime i18n
  dependency to eight otherwise-static builds, for strings surrounded by exclusively
  English API material anyway. Revisit only if reference pages themselves become
  translatable.

## Translation management for a solo maintainer

| Option | Cost | Fit |
|---|---|---|
| **Weblate hosted "Libre" plan — recommended** | Free for any public OSI/FSF-licensed repo, no minimum age or lead attestation | Native `.po` support, continuous git sync; its automatic-translation add-on stamps MT output `fuzzy`, pairing with `gettext_allow_fuzzy_translations = False` for MT-first-with-human-gate at zero custom tooling. GPL, but consumed as SaaS/container — "running a GPL program," not "linking one into `sphinx-build`" (ledger §2.6). Self-hosts later, no migration. |
| Crowdin | Free for OSS, but gated: 3+ months old, requester must be project lead, enrolls translations in Crowdin's Global Translation Memory | More polish than a docs-only repo needs; the gatekeeping alone makes it a worse default than Weblate. |
| Transifex | Free OSS program exists but is trial-then-convert; paid tiers otherwise $135–625/mo | `sphinx-intl` has first-class support (`update-txconfig-resources`), but the conversion risk makes it a worse default. |
| Tolgee | Apache-2.0, self-hosted free, unlimited keys | Built for in-context live-app UI strings, not `.po`/Markdown doc trees — weak fit here. |
| Plain git + file review | Zero tooling cost | Reasonable v0 bootstrap for the first locale, maintainer-only. No web UI for volunteers, no progress dashboard, no MT integration. |

**Pick: plain git review for the first locale, Weblate once a second locale or a
volunteer translator shows up.** Weblate's `.po` integration is proven for the Sphinx
side the moment it is lit up; whether its native file handling extends cleanly to MDX
(versus needing an MDX↔`.po` bridge such as `po4a`'s `Text` module or `mdpo`) is
**unverified** — check against a real MDX file before committing the shell's workflow to
it, and treat plain-git whole-file review as the fallback if it does not.

## hreflang, x-default, and per-locale sitemaps

Nothing in either toolchain emits `hreflang="x-default"` today — zero hits grepping both
`sphinx-gp-sitemap` and the Astro/`@astrojs/sitemap` stack. Owning `<head>` and sitemap
generation directly makes this trivial to add rather than a gap to patch around:

- Every shell page emits, in `<head>`:
  ```html
  <link rel="alternate" hreflang="en" href="https://libtmux.org/concepts/panes/" />
  <link rel="alternate" hreflang="ja" href="https://libtmux.org/ja/concepts/panes/" />
  <link rel="alternate" hreflang="x-default" href="https://libtmux.org/concepts/panes/" />
  ```
  omitting the `ja` alternate entirely when that page is fallback-only (see above) —
  a hreflang cluster should only ever point at real translations.
- The shell emits `sitemap-en.xml` and `sitemap-ja.xml` (English excludes nothing;
  Japanese excludes fallback pages), plus a root `sitemap-index.xml` listing both. Each
  reference build keeps emitting its own single-language `sitemap.xml`, listed from the
  root index alongside the two shell sitemaps — reference sitemaps need no locale
  handling since they carry no locale segment.
- Locale codes in the URL are lowercase BCP-47 (`ja`, `zh-cn`), differing from Sphinx's
  own `language` convention (`zh_CN`) — one small mapping table where the two meet.

## Open questions this document does not close

- **Ledger §7.10 item 5** — whether per-port guide prose (not just the shell) is
  translatable — is unresolved. If it closes toward "yes," `sphinx-intl` above needs no
  redesign, only activation.
- Whether Weblate's file handling covers MDX directly, or needs an MDX↔`.po` bridge, is
  unverified; resolve with a real test file before the second locale ships.
- Runtime-injected reference-page chrome staying English-only (this document's
  recommendation) versus reading a stored locale preference — worth a deliberate
  decision only once a second locale gains real traction.
