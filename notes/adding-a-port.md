# Adding a port

`site/src/lib/ports.ts` is the single source of truth for the ten ports: nav,
the port switcher, the sidebar scope, the parity table,
sitemap generation, and the build script all read it. Adding a port means
editing it and the handful of places that can't derive from it — nowhere
else should need a per-port `if`.

## 1. Add the entry to `ports.ts`

Add a `Port` object to the `PORTS` array with every required field:
`slug`, `name`, `language`, `packageName`, `repo`, `checkout`, `worktree`,
`versionedDocs`, `tagGrammar`, `renderer`, `generator`, `installs`,
`initProject`, and `installForms`. Add `registry`, `packages`,
`productAvailability`, `ecosystemHost`, and `publishesOwnApi` only when their
contracts apply. Decide the renderer and hosting ownership first:

- **Ecosystem-hosted** (`renderer: 'none'`, `ecosystemHost` set) only when a
  canonical, free, self-updating host for that language's ecosystem already
  exists and is where that language's developers already look — the bar
  that justified Rust → docs.rs, Go → pkg.go.dev, Java/Kotlin → javadoc.io.
  Never route a new port to Read the Docs; it's a generic hosting platform,
  not a canonical package index, and self-hosting gets you the design system
  and version scheme that RTD would not.
- **Site-rendered** otherwise, with `renderer` set to whichever of `sphinx`,
  `astro`, or `native-skinned` fits the language's own generator — reuse an
  existing renderer before inventing a fourth. See `notes/architecture.md`
  for what each renderer expects as input.

`slug` becomes the URL segment (`/<slug>/<version>/...`) and the manifest key
in `versions.json` (§4) — pick it once, since changing it later is a URL
break for every published version.

## 2. Add the worktree

Every port keeps its docs-tooling changes on a dedicated worktree, branch
`docs-site`, checked out alongside (not inside) the port's normal checkout —
`checkout` and `worktree` in the new `Port` entry should point at real,
matching paths before anything else in this checklist is attempted:

```console
$ git -C ~/work/libtmux/libtmux-<lang> worktree add \
    ~/work/libtmux/libtmux-<lang>-docs \
    -b docs-site
```

(Python instead lives at `~/work/python/libtmux` and
`~/work/python/libtmux-python-docs` — see `AGENTS.md`'s worktree table.)

## 3. Wire the reference generator

In the new worktree, on `docs-site`:

- **Ecosystem-hosted port**: nothing to wire here. Confirm the ecosystem host
  actually serves this package (`cargo add`/`go get`/the Maven coordinate
  from `install` resolves), and stop — there is no generator to run.
- **`sphinx` port**: point the language's doc build at `sphinx-gp-theme`,
  same as the Python and C++ ports already do. C++ specifically routes
  through Doxygen `GENERATE_XML=YES` / `GENERATE_HTML=NO` → Breathe, so no
  Doxygen-produced HTML is ever published (see `notes/architecture.md`'s
  licensing note).
- **`astro` port**: export a deterministic native artifact from the selected
  source revision and add an adapter in `packages/api-model/src/languages/`.
  Wire `scripts/gen-api-model.mjs`, the static imports in
  `site/src/lib/api-models.ts`, and the generated model/nav/path sidecars.
  If the port owns guides, stage them from the same checkout with explicit
  routes and source provenance. Ruby's inventory/YARD/RBS adapter and Lua's
  LuaLS adapter are the current examples.
- **`native-skinned` port**: point the language's own generator (DocC,
  rustdoc, Dokka, ...) at our CSS/token output and a header/footer injection
  point, following whichever of those generators is the closest precedent —
  see `notes/architecture.md`'s renderer table and the injection-mechanism
  notes in `notes/research/04-versioning.md` §5 for the pattern used by each
  existing skinned generator.

## 4. Add `versions.json` entries

`versions.json` is one runtime file at each locale root — see
`notes/architecture.md`'s version-axis section for the exact shape
(`VersionManifest`: `{ schema: 1, ports: Record<slug, VersionEntry[]>,
defaultVersion: Record<slug, string> }`). Adding a port means:

- a new key in `ports` holding that port's `VersionEntry[]` — at minimum a
  `trunk` entry. Add `next` for a built prerelease or `stable` for a built
  stable release; never point a release alias at trunk;
- a new key in `defaultVersion` naming which of those entries is the
  indexable one (`robotsFor()` and the sitemap gate both key off this).

The committed file is an offline seed. A successful port publisher writes
only `manifest/<port>.json`; the next shell publication validates and merges
those fragments into the runtime `versions.json`. PR previews stay in their
own baked manifest and never enter a production fragment.

## 5. Add the CI caller

The publish workflow lives in the **port's own repository**
(`.github/workflows/docs.yml` there), calling a reusable workflow published
by this repo. That repository is public — an agent working from this repo
never pushes to it directly. Land the caller workflow as a commit on that
port's `docs-site` worktree branch and hand it to the maintainer as a PR
against the port repo; do not push it yourself, and never push anything to a
port repo's remote from an agent session. See `AGENTS.md`'s push policy.

The caller's `path-prefix` input must be version-qualified —
`<slug>/<version>` (e.g. `ts/v0.1.0`, or `ts/stable` on the alias rebuild),
never the bare `<slug>/*` — because the called workflow runs
`aws s3 sync --delete` scoped to exactly that prefix. An unqualified prefix
widens the delete to the port's whole tree, wiping every previously
published version of it on the next deploy.

Native HTML and CSS use the shell assets under the default locale. Both
`build-site.sh` and the reusable publish workflow normalize older
`/_shell/` URLs before publication. Callers pin the reusable workflow to a
commit; publishing this repository alone does not update those callers.
The maintainer must update the workflow pin to a revision containing this
normalization before republishing native documentation. Keep any docs
checkout pin at the same revision as the reusable workflow.

Every named version build must also pass the selected port, version kind,
source ref, full source SHA, checkout override, default identity, and optional
alias target to `build-site.sh`. The script verifies that the ref, checkout
HEAD, exported model, source guides, examples, links, canonicals, robots, and
manifest entry all name that same source. A branch, tag, or PR slug without
this binding is rejected.

PR builds are unprivileged. A same-repository PR may publish to
`en/<port>/pr-N` through the `docs-preview` environment; a fork only builds an
artifact. Cleanup runs from `pull_request_target` without checking out PR code
and deletes exactly that prefix. Tag publication is write-once: identical
bytes are a no-op and different bytes fail before upload.

## Checklist summary

- [ ] `ports.ts`: new `Port` entry, renderer and product availability decided
- [ ] Worktree added on branch `docs-site`, `checkout`/`worktree` paths match
- [ ] Native exporter and API-model adapter cover the public surface
- [ ] Source-owned prose/examples stage from the selected revision
- [ ] Registry, version grammar, installs, prompts, and product routes agree
- [ ] Source-bound trunk, branch, PR, tag, and alias builds are checked
- [ ] CI caller and exact preview cleanup are committed on `docs-site`
- [ ] Port and reusable-workflow pins use the same public full site SHA
- [ ] Maintainer opens the port PR and coordinates publication and shell search
