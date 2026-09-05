# Versioning

Versioning is entirely ours to build: there is no `starlight-versions` dependency, no
"early development" plugin risk, nothing to wait on upstream. The mechanism is one Astro
build per version prefix, a manifest that CI writes, and a switcher we own that ships as
one runtime bundle mounted two ways — a thin Astro wrapper for the shell and our own
reference pages, and a standalone script injected into the four skinned-native
generators. `/stable/` and `/latest/` are real, separate builds, not URL rewrites, because
canonical tags and sitemaps bake absolute URLs even when navigation links don't.

## 1. URL scheme: path prefixes, not subdomains

```
libtmux.org/py/v0.46.2/          immutable tag build
libtmux.org/py/0.x/              mutable branch build
libtmux.org/py/stable/           separate build, own canonical
```

The alternative, seen in production, is a subdomain per version: Kubernetes'
`v1-36.docs.kubernetes.io`, or React's/Angular's `18.react.dev`/`v15.angular.io`.
Kubernetes uses it because Netlify site-per-branch suited many teams shipping many
parallel minors with full infrastructure isolation between them; React and Angular use it
only for one-time archival of dead majors — frozen exports, not a live switcher matrix.

libtmux is one project with eight ports, not a multi-tenant platform. Path prefixes on
one domain keep one CloudFront distribution, one certificate, and one manifest scheme to
reason about, and make cross-language navigation (a "same task in eight languages" page
linking from `/py/` to `/ts/`) a relative link instead of a cross-origin one. The cost —
any generator that assumes it owns the domain root needs a base-path override — is one
every one of the eight already pays anyway, version scheme aside; versioning reuses the
same knob (§3), it doesn't add a new requirement.

Reference paths carry no locale segment — `libtmux.org/py/v0.46.2/api/`, never
`.../v0.46.2/ja/api/` — because reference content is generated from source doc comments,
and translating those is a separate, larger decision covered in `05-i18n-translations.md`.
Shell prose does carry a locale segment, but outermost (`libtmux.org/ja/concepts/`), never
nested inside a version prefix.

## 2. The `versions.json` manifest

The schema, from the version-manifest survey: each entry carries `kind`
(`tag`, `branch`, or `alias`), `eol`, `supported`, and `docs_shell` — the guide-prose
build a tag's reference belongs to (§7). Two generator-agnostic precedents converge on it
independently: pydata-sphinx-theme's `switcher.json` and `mike`'s `versions.json`. Both
are written by CI at deploy time, never derived by listing a bucket — S3 key names alone
can't carry `eol` dates or `supported` flags.

**The manifest is per language, not a single site-wide file.** The standing rule in
`00-DECISIONS.md` §6 — "give each repository an exclusive manifest key so there is no
shared mutable state to race on" — means eight independent CIs (`libtmux`, `libtmux-ts`,
`libtmux-rs`, …) cannot safely write into one shared `libtmux.org/versions.json`; that
*is* the shared mutable state the rule forbids. So each language owns its own manifest at
a fixed, absolute URL:

```
libtmux.org/py/versions.json
libtmux.org/ts/versions.json
libtmux.org/rs/versions.json
```

only ever written by that language's own repository, in the same CI job that runs the
publish, read-modify-write serialised by `concurrency: {group, queue: max}`
(`00-DECISIONS.md` §6/§7.6) since a tag push appends one entry rather than replacing the
file. The switcher derives the fetch URL from `location.pathname`'s first segment, so no
build needs to know the other seven languages' manifest locations.

```json
{
  "versions": [
    { "version": "v0.46.2", "kind": "tag",    "eol": false, "supported": true,  "docs_shell": "0.x" },
    { "version": "v0.40.0", "kind": "tag",    "eol": true,  "supported": false, "docs_shell": "0.x" },
    { "version": "0.x",     "kind": "branch", "eol": false, "supported": true,  "docs_shell": "0.x", "ref": "master" },
    { "version": "stable",  "kind": "alias",  "eol": false, "supported": true,  "docs_shell": "0.x", "tracks": "v0.46.2" },
    { "version": "latest",  "kind": "alias",  "eol": false, "supported": true,  "docs_shell": "0.x", "tracks": "0.x" }
  ]
}
```

Two fields the original survey's schema didn't need: `tracks`, because that survey
assumed aliases never got their own build, so nothing pointed *at* a target — §3 below
overturns that, so an alias entry must say what it currently mirrors, both for the
switcher's label ("stable (v0.46.2)") and so CI knows what to rebuild on promotion; and
`ref` on a branch entry, since `"0.x"` is a manifest slug, not the git ref CI actually
builds from (`master`, here).

The manifest itself needs short `Cache-Control` and lives at a stable URL, per the
runtime-chrome rule in `00-DECISIONS.md` §6: a version published a year ago must still
see today's list of supported versions when its switcher fetches this file, so the
manifest cannot be baked into any one build. This is also pydata-sphinx-theme's own rule
for `switcher.json` — the URL must be absolute and persistent, not resolved relative to
whichever build is asking.

## 3. Why `/stable/` and `/latest/` are separate builds

The obvious-sounding argument — "generators bake absolute paths into their navigation, so
serving one build at two prefixes breaks links" — is **false for six of the seven
generators checked**. Sphinx's `pathto()`/`relative_uri()`, rustdoc's `root_path()`,
TypeDoc's `baseRelativeUrl`, Dokka's `pathToRoot`, DocFX's `_rel`, and doc2go all compute
page-depth-relative links; the identical build output genuinely could serve at
`/py/v0.46.2/` and `/py/stable/` with no broken hrefs. Only DocC bakes an absolute path —
`--hosting-base-path` literally substitutes the token `{{BASE_PATH}}` into every route's
`index.html`, and docc-render's compiled bundle reads its own `publicPath` from the same
placeholder — so DocC output cannot serve at two prefixes at all.

**The axis that actually decides it is canonical tags and sitemaps, not link
relativity.** These bake absolute URLs at build time regardless of whether navigation
links are relative. Serving byte-identical output at two prefixes — whether by literal S3
copy or a CloudFront Function/KeyValueStore edge rewrite — produces a canonical tag that
says the wrong URL, or none at all: true duplicate content with no dedup signal for a
crawler.

This was checked against the flagship precedent, not assumed. `doc.rust-lang.org` runs
libtmux's exact target stack — S3 behind CloudFront, no app server:

```console
$ curl -sI https://doc.rust-lang.org/book/
```

returns `x-amz-version-id: vgKq4so.D7Pgt6eci1g006tRQLC.I2Rm`, and the identical header on
`.../stable/book/` proves the two URLs are the literal same S3 object — a mutable alias
resolved at the edge, exactly what a KVS rewrite would produce. The bodies diff clean, and
neither URL carries a canonical tag at all (`rg -i canonical` over both: zero matches).
`doc.rust-lang.org` proves the mechanism works technically and proves the SEO consequence
is real: this is what "identical bytes, no dedup signal" looks like in production, not a
hypothetical.

Checked against libtmux's own docs at the same time: `html_baseurl` — the Sphinx setting
that turns the canonical tag on — is unset in both the project's own `conf.py` and
gp-sphinx's shared `config.py`, zero grep hits in either file. **libtmux's documentation
emits no canonical tag today, at any URL.** This is a present gap this project closes as
part of shipping versioning, not a hypothetical risk to design around.

**Decision:** build `/stable/` and `/latest/` as real, separate builds, for all eight
languages, with the base-path flag *and* the canonical flag (where the generator has one)
set to the alias's own URL — not the tag's. Reserve the CloudFront Function plus
KeyValueStore for exactly one job: a 302 redirect on the bare language root
(`/py` → `/py/stable/`), never a rewrite of an already-qualified `/lang/version/...` URL
to different backing bytes (full code in `06-aws-s3-cloudfront.md`) — the KVS rewrite is
cheap and tempting to over-apply, and doing so reintroduces exactly the duplicate-content
problem this section exists to avoid.

Per-generator canonical mechanisms, checked rather than assumed uniform:

| Generator | Canonical mechanism | Status |
|---|---|---|
| Sphinx (Python, C++) | `html_baseurl` → `ctx['pageurl']` → `layout.html`'s `<link rel="canonical">` | Verified from source; confirmed unset today |
| rustdoc | none — `--html-in-header` injects one static string, can't vary per page | Verified absent; no per-page canonical without patching rustdoc |
| Dokka, DocC | unknown | Unverified — test before relying on it |
| TS, .NET, Go (our renderer) | our Astro renderer sets `<link rel="canonical">` directly | Fully in our control |

## 4. Branch docs coexisting with tag docs

Tags and branches coexist under one `/py/` prefix, disambiguated by the manifest's `kind`
field, with different lifecycle rules:

- **Tags** (`v0.46.2`) are immutable: built once, synced once, `Cache-Control: public,
  max-age=31536000, immutable`, never invalidated, never rebuilt (`00-DECISIONS.md` §7.5).
- **Branches** (`0.x`) are mutable: rebuilt on every merge, `s3 sync --delete` against
  their own prefix, short `max-age`, invalidated on publish.

This matters today mainly for whatever branch is actively taking guide-prose edits
between releases — libtmux is pre-1.0 and ships everything as `v0.Y.Z` tags off one line
of development, so there is currently one branch build (`0.x`) and a growing set of tag
builds under it. The schema is built for the case that becomes real once libtmux crosses
1.0 and keeps a maintained `1.x` line alongside active `2.x` development: two branch
builds, each with tag builds underneath it, and the `docs_shell` field on each tag saying
which branch's guide prose its reference content belongs with. Nothing about the manifest
or the build mechanism changes when that day comes — only the number of `branch`-kind
rows in it.

## 5. The owned mechanism

**Build-per-prefix, not a runtime dynamic route.** Each language repository's CI is
triggered by one ref — a tag push or a branch push — and only ever needs to build that one
version, so the mechanism is a plain build invocation per publish with a flag setting that
run's base path and canonical URL:

```console
$ npx astro build \
    --site https://libtmux.org \
    --base /ts/v0.46.2
```

An Astro `[version]/[...slug]` route driven by `getStaticPaths()` would need one build to
already enumerate every past version before emitting anything — the wrong shape for a CI
job that fires once per tag. That form still has a place for a one-shot bulk regeneration
(a template change applied to every previously published branch build at once), via a
script looping the same plain build over every ref — never as a live route, since the site
is pre-rendered static output on S3 with no request-time Astro server to route against.

**One switcher, two mount forms.** Rather than write the fetch-and-render logic twice —
once in Astro-flavored TypeScript, once in vanilla JS for the four skinned-native
generators — there is exactly one runtime bundle, `version-switcher.js`, published only
by the shell's own deploy at `libtmux.org/_shell/version-switcher.js` with short
`Cache-Control` (same runtime-chrome rule as the manifest: a fix must reach
already-published immutable versions without rebuilding them). It must not ship from a
per-language build's own `public/`, which would land it under that build's own base path
(`/ts/v0.46.2/_shell/…`) instead of one shared URL. The Astro component is a thin wrapper
that renders the mount point and pulls in that same script:

```astro
---
// src/components/docs/VersionSwitcher.astro — renders the mount point
// only. Behavior lives in the one runtime bundle below, shared with
// the four skinned-native generators: one switcher algorithm across
// nine rendering surfaces, not nine reimplementations that can drift.
const { lang } = Astro.props;
---

<div id="libtmux-version-switcher" data-lang={lang}></div>
<script src="/_shell/version-switcher.js" is:inline></script>
```

`data-lang` exists because `location.pathname` alone is ambiguous on the shell's own root
pages, which carry no version segment at all; the bundle prefers it when present and falls
back to parsing the path, shown here in full:

```js
// public/_shell/version-switcher.js — injected into Sphinx, rustdoc,
// Dokka and DocC output (table below); also loaded by the Astro shell
// and our own TypeScript/.NET/Go reference pages.
(function () {
  var mount = document.getElementById("libtmux-version-switcher");
  if (!mount) return; // template forgot the mount div

  // §1's path-prefix scheme means location.pathname is always
  // /<lang>/<version>/..., so the manifest URL derives from the URL
  // itself — no per-build config to keep in sync across eight repos.
  var parts = location.pathname.split("/").filter(Boolean);
  var lang = mount.dataset.lang || parts[0];
  var current = parts[1] || "", rest = parts.slice(2).join("/");
  if (!lang) return;

  fetch("/" + lang + "/versions.json", { credentials: "omit" })
    .then(function (r) { if (!r.ok) throw 0; return r.json(); })
    .then(function (m) { render(m.versions || []); })
    .catch(function () { mount.hidden = true; }); // fail closed

  function render(versions) {
    var list = document.createElement("ul");
    list.className = "libtmux-version-list";

    versions.forEach(function (entry) {
      var a = document.createElement("a");
      var label = entry.version;
      if (entry.kind === "alias" && entry.tracks) label += " (" + entry.tracks + ")";
      a.textContent = entry.eol ? label + " — EOL" : label;
      a.href = "/" + lang + "/" + entry.version + "/" + rest;
      if (entry.version === current) a.setAttribute("aria-current", "true");

      // OAC in front of the S3 REST origin returns 403, not 404, for a
      // missing key — treat both as "not in that version" and fall
      // back to the version's own root rather than a dead link.
      fetch(a.href, { method: "HEAD" }).catch(function () { return { status: 404 }; })
        .then(function (r) {
          if (r.status === 403 || r.status === 404) {
            a.href = "/" + lang + "/" + entry.version + "/";
          }
        });

      var li = document.createElement("li");
      li.appendChild(a);
      list.appendChild(li);
    });

    mount.replaceChildren(list);
  }
})();
```

The per-entry `HEAD` check fires once per manifest row on every page load; that scales
with tag count, so in practice defer it to a click/focus event on the mount rather than
running it unconditionally, once the manifest is large enough for it to matter.

Injection points, one per skinned-native generator (Python and C++ share one, since they
share `sphinx-gp-theme`):

| Language(s) | Generator | Injection mechanism | Status |
|---|---|---|---|
| Python, C++ | Sphinx / `sphinx-gp-theme` | theme header template adds the mount `<div>` and `<script src>` directly | Must mount the **same** bundle, not a second switcher off sphinx-multiversion's Jinja context (§6) |
| Rust | rustdoc | mount `<div>` via `--html-before-content`, script tag via `--html-in-header` (two flags, both static fragments) | Only the fragments are baked at build time; the bundle itself still loads from the runtime URL |
| Java, Kotlin | Dokka | `templatesDir`, overriding `base.ftl` | `customStyleSheets` is CSS-only and cannot inject a script or a mount `<div>` |
| Swift | DocC | `header.html`, auto-wrapped into a `<custom-header>` element by docc-render (ledger §7.1) | **Unverified**: script execution inside the cloned Shadow DOM template is untested — the highest-risk injection point here |

## 6. `sphinx-multiversion`, scoped to the Sphinx languages only

This applies to Python and C++ only; the Astro-rendered and skinned-native languages get
versioning from the build-per-prefix loop in §5, with no such dependency.

**The mechanism is real and was reproduced, not assumed.** `main.py` computes
`confdir_absolute` once, outside the per-ref loop, and passes `-c confdir_absolute` to
every `sphinx-build` invocation — always today's checked-out `conf.py`, theme and CSS —
while each ref's content comes separately via `git archive`. It is a deliberate,
documented choice: commit `ab9bac8` (2020-08-05) is titled "Always use original conf.py
file." Reproduced empirically: a marker string injected only into the uncommitted
working-tree `conf.py` and `custom.css` of a local libtmux clone appeared in the built
output of tags `v0.20.0` and `v0.40.0`, while each tag's own prose matched its own commit.
"Old content, current design" is genuine.

**It is broken against Sphinx 9, today.** `sphinx-multiversion` crashes at startup with
`TypeError: Config.read() takes 2 positional arguments but 3 were given` — Sphinx 9 made
`overrides` and `tags` keyword-only, and multiversion still calls it positionally. The
project's own CI has failed on this exact traceback on every push since 2026-04-20. The
fix is small and known — PR #202, 16 lines, verified working by applying it and
rebuilding — but has sat unmerged for eight months against an unresponsive maintainer; a
separate issue, "Is this project still maintained?", has zero response. None of this
blocks libtmux today: gp-sphinx pins `sphinx>=8.1,<9`. Track raising that pin and
patching or vendoring PR #202 as one linked decision, not two independent ones.

**It silently drops refs.** A tag is excluded from the build — log line, no build failure
— if its historical `conf.py` fails to import under today's installed packages.
libtmux's own `v0.10.0` is dropped today because its old `conf.py` imports `alagitpull`
and `sphinx_issues`, neither installed now; upstream issue #165 has tracked this,
unanswered, since 2025-03-17.

**It ships no switcher UI.** It supplies only a Jinja context (`versions.branches`,
`versions.tags`, `vpathto()`) and one bullet-list example partial. The widget goes into
`sphinx-gp-theme` — and per the injection table above, it should be the *same* runtime
bundle every other language mounts, reading the same `versions.json`, not a bespoke render
of multiversion's own context. Two switchers fed by two data sources is the kind of drift
this design otherwise eliminates.

**What its job actually is, given the rest of this design.** `sphinx-multiversion`'s
value proposition is re-rendering every historical tag against *today's* theme at build
time. But the ledger's §6 says shared chrome — header, footer, switcher, tokens — loads
at runtime from a stable URL precisely so published builds pick up chrome fixes without a
rebuild, and its §7.5 says a published tag prefix is never rebuilt. Between those two
rules, a
freshly tagged release doesn't need multiversion at all: one ordinary `sphinx-build`
against the shared `conf.py` already gets "today's design" for that tag, and
runtime-loaded chrome keeps it current forever after without touching it again. What's
left for `sphinx-multiversion` is a **one-shot backfill**: when a *page-template* change
(not a runtime-chrome change) needs every historical tag re-rendered at once, it does that
in one pass. That is occasional maintenance work, not the steady-state per-tag publish
path.

**Unverified:** whether `html_baseurl` can be derived per-ref inside the shared `conf.py`,
keyed off multiversion's own `smv_current_version` override — which determines whether a
backfill run can emit a correct per-tag canonical (§3) for every historical version in one
pass, or needs canonical correctness patched in separately afterward. Test before relying
on `sphinx-multiversion` for anything canonical-tag-bearing.

`sphinx-polyversion`, checked as an alternative, is measurably healthier — PyPI matches
its latest git tag exactly, versus multiversion's multi-year gap, and four open issues
against fifty-seven — but architecturally the wrong fit: its default builds each version
in its own isolated environment against *that version's own* `conf.py`, giving "old
content, period-correct design," the opposite of what this section needs.

## 7. Guide prose and API reference version at different rates

No static-hosting precedent supports the cleanest theoretical answer here. Sentry's docs
version per page, opt-in, via a filename suffix (`index.mdx` shared, `index__v7.x.mdx`
only where a page actually diverged) — but that requires a request-time router
(Next.js middleware) with no static-file equivalent. DocFX's `moniker range` blocks ship
every version's prose in one HTML page, toggled client-side by a query parameter — viable
only when prose is mostly shared across versions, which is not libtmux's situation across
eight independently maintained ports.

The practical compromise: **guide prose versions at branch granularity, API reference
versions at tag granularity**, and guide pages always link into `stable` (or `latest`)
rather than a pinned tag, so a guide page never dead-ends into a frozen old reference
build. This is a linking policy, not a claim that tag builds omit guides — Sphinx builds
whatever the ref contains, so `/py/v0.46.2/` genuinely does carry that tag's guide prose
too, frozen alongside its reference. What "branch granularity" actually buys: `/py/0.x/`
is where a prose fix lands *between* releases, and where the shell's guide sidebar always
points, so a reader following a guide link never has to know or care which tag is current;
`/py/stable/` and `/py/latest/` each rebuild from whichever ref they currently track
(§2's `tracks` field), so their guide prose is always as fresh as their reference. Pre-1.0
with one active branch, this collapses to one current guide/reference pair on `0.x`, plus
one frozen guide+reference snapshot per tag. `docs_shell` earns its purpose once there are
two branches to disambiguate: it says which branch's guide prose a given tag's reference
belongs with, so the switcher pairs them correctly without conflating "which API tag" with
"which guide branch." Two CI triggers write into the same `/py/<slug>/` prefix — one on
branch push, one on tag push — each following its own lifecycle from §4.

## 8. SEO: canonical, noindex, sitemaps

**Canonical**, per §3: set at build time via each generator's base-path/canonical flag,
pointed at the alias's own URL for `/stable/` and `/latest/` builds and the tag's own URL
for tag builds. This closes the concrete gap already identified — libtmux emits no
canonical tag today because `html_baseurl` is unset — for the Sphinx languages; the other
seven need the equivalent per-generator knob checked against §3's table before assuming
parity.

libtmux follows the served-in-place pattern (Read the Docs, pkg.go.dev) rather than
Django's redirect-to-concrete pattern: Django's `/en/stable/` issues a real `302` to the
current dev tip, while RTD and pkg.go.dev serve `/stable/`'s own bytes directly with its
own canonical tag. Served-in-place avoids an extra hop on the site's most-visited URL, and
most generators expose *some* base-URL knob to make it work even where the canonical tag
specifically is unverified (Dokka, DocC) — rustdoc is the confirmed exception (§3's table),
with no per-page canonical mechanism to set at all.

One further open item this design doesn't resolve: whether `libtmux.org/py/` is itself
canonical while the existing Sphinx output also serves live from `libtmux.git-pull.com` is
flagged, unclosed, in `00-DECISIONS.md` §7.10 item 5 — treat cross-host duplication
between the two as dependent on that decision, not solved by anything in this document.

**`noindex` cannot be added to an already-published immutable tag**, because
`00-DECISIONS.md` §7.5 forbids ever touching one again. The mechanism has to live outside
the page: the shell build generates `robots.txt` and `sitemap.xml` from each language's
`versions.json`, `Disallow`-ing and omitting any entry with `eol: true` — exactly Read the
Docs' own `hidden`-version filter. This is deliberately the weaker RTD signal, not
pkg.go.dev's per-page `<meta name="robots" content="noindex">`: a page a crawler is
`Disallow`ed from fetching never gets a chance to see an in-page `noindex` either, so the
two are not layerable, and only one — the one that doesn't require rebuilding the tag —
is available to us at all.

A stronger option exists in principle: a CloudFront response-headers policy on a cache
behavior scoped to the EOL'd tag's own path (`/py/v0.20.0/*`), setting `X-Robots-Tag:
noindex` as pure edge configuration with no S3 write. **Left as an open question**, not a
decision: CloudFront caps cache behaviors per distribution in the low tens by default, and
"one behavior per EOL'd tag, across eight languages, indefinitely" is a fundamentally
different scale than the single root-redirect behavior this design already budgets for
(§3). If that cap turns out to bind, the fallback is a viewer-response CloudFront Function
reading an `eol` flag out of the same KeyValueStore already holding the redirect targets —
which would widen the KVS's scope past "root redirect only" (§3) and needs its own
sign-off before it's adopted, not just an implementation detail.

Both the sitemap/`robots.txt` mechanism and any future edge-header mechanism read the same
`eol` flag, but neither fires automatically: marking a version EOL in `versions.json`
still requires the shell's next scheduled rebuild (for `robots.txt`/`sitemap.xml`) and,
if adopted, a KVS update dispatched by that same runbook step — write down "mark EOL" as
a two-step runbook, not a single edit.

**Previews** get the stronger, always-on treatment: PR builds are served from a separate
host, `preview.libtmux.org`, never a path under `libtmux.org`, with `X-Robots-Tag:
noindex` applied via a CloudFront response-headers policy on that entire distribution —
there is no per-request app server to set the header dynamically, and no build-time flag
to rely on since preview content is by definition draft. This mirrors Read the Docs'
isolation of externally-triggered PR-preview domains from its indexing rules.
