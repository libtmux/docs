# Adding a port

`site/src/lib/ports.ts` is the single source of truth for the eight (soon
nine) ports: nav, the port switcher, the sidebar scope, the parity table,
sitemap generation, and the build script all read it. Adding a port means
editing it and the handful of places that can't derive from it — nowhere
else should need a per-port `if`.

## 1. Add the entry to `ports.ts`

Add a `Port` object to the `PORTS` array with every required field:
`slug`, `name`, `language`, `packageName`, `repo`, `checkout`, `worktree`,
`referenceMode`, `renderer`, `generator`, `install`. Decide
`referenceMode`/`renderer` first, since that decision belongs in
`ports.ts`'s own policy comment, not this checklist:

- **`ecosystem`** (`renderer: 'none'`, `ecosystemHost` set) only when a
  canonical, free, self-updating host for that language's ecosystem already
  exists and is where that language's developers already look — the bar
  that justified Rust → docs.rs, Go → pkg.go.dev, Java/Kotlin → javadoc.io.
  Never route a new port to Read the Docs; it's a generic hosting platform,
  not a canonical package index, and self-hosting gets you the design system
  and version scheme that RTD would not.
- **`self-hosted`** otherwise, with `renderer` set to whichever of `sphinx`,
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

- **`ecosystem` port**: nothing to wire here. Confirm the ecosystem host
  actually serves this package (`cargo add`/`go get`/the Maven coordinate
  from `install` resolves), and stop — there is no generator to run.
- **`sphinx` port**: point the language's doc build at `sphinx-gp-theme`,
  same as the Python and C++ ports already do. C++ specifically routes
  through Doxygen `GENERATE_XML=YES` / `GENERATE_HTML=NO` → Breathe, so no
  Doxygen-produced HTML is ever published (see `notes/architecture.md`'s
  licensing note).
- **`astro` port**: produce the JSON/YAML model this port's build emits
  (an api-extractor-shaped JSON, a docfx-metadata-shaped YAML, or
  equivalent), and add the loader that turns it into a content collection —
  `ingest/` is where these loaders live once that directory is populated.
  There is no themable off-the-shelf HTML generator for this lane by
  construction; the pages are hand-built against the model, same as
  TypeScript and .NET are.
- **`native-skinned` port**: point the language's own generator (DocC,
  rustdoc, Dokka, ...) at our CSS/token output and a header/footer injection
  point, following whichever of those generators is the closest precedent —
  see `notes/architecture.md`'s renderer table and the injection-mechanism
  notes in `notes/research/04-versioning.md` §5 for the pattern used by each
  existing skinned generator.

## 4. Add `versions.json` entries

`versions.json` is one file at the site root, not one per port — see
`notes/architecture.md`'s version-axis section for the exact shape
(`VersionManifest`: `{ schema: 1, ports: Record<slug, VersionEntry[]>,
defaultVersion: Record<slug, string> }`). Adding a port means:

- a new key in `ports` holding that port's `VersionEntry[]` — at minimum a
  `trunk` entry, and the `stable`/`latest` `alias` entries once a first
  release exists;
- a new key in `defaultVersion` naming which of those entries is the
  indexable one (`robotsFor()` and the sitemap gate both key off this).

This file is written by CI at deploy time, never hand-maintained — the CI
caller step below is what actually produces the entries.

## 5. Add the CI caller

The publish workflow lives in the **port's own repository**
(`.github/workflows/docs.yml` there), calling a reusable workflow published
by this repo. That repository is public — an agent working from this repo
never pushes to it directly. Land the caller workflow as a commit on that
port's `docs-site` worktree branch and hand it to the maintainer as a PR
against the port repo; do not push it yourself, and never push anything to a
port repo's remote from an agent session. See `AGENTS.md`'s push policy.

The caller's `prefix` input must be version-qualified —
`<slug>/<version>` (e.g. `ts/v0.1.0`, or `ts/stable` on the alias rebuild),
never the bare `<slug>/*` — because the called workflow runs
`aws s3 sync --delete` scoped to exactly that prefix. An unqualified prefix
widens the delete to the port's whole tree, wiping every previously
published version of it on the next deploy.

## Checklist summary

- [ ] `ports.ts`: new `Port` entry, `referenceMode`/`renderer` decided
- [ ] Worktree added on branch `docs-site`, `checkout`/`worktree` paths match
- [ ] Reference generator wired (or confirmed as ecosystem, nothing to wire)
- [ ] `versions.json`: new `ports[slug]` entries and a `defaultVersion[slug]`
- [ ] CI caller workflow committed to the port's `docs-site` branch, opened
      as a PR against the port repo — never pushed directly
