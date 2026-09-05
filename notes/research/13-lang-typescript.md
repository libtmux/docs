# TypeScript reference pipeline

TypeDoc cannot run against libtmux-ts: TypeScript 7's Go-native compiler rewrite deleted
the classic Compiler API that TypeDoc depends on, so TypeDoc crashes at module load —
even `typedoc --version` throws. Every TypeDoc-derived tool (`typedoc-plugin-markdown`,
`starlight-typedoc`, `sphinx-js`) is blocked identically. The working path is
`@microsoft/api-extractor`, which parses emitted `.d.ts` files instead of compiling
source and therefore never touches the project's TypeScript 7 install. It emits a JSON
API model only, no HTML — so, unlike every other language port, the TypeScript reference
has no themable generator to skin. Page rendering is hand-built against that JSON as an
Astro content-collection source, per `24-astro-shell.md`.

## The ecosystem convention, and what libtmux.org adds

TypeScript has no `docs.rs`/`pkg.go.dev` equivalent — no host that auto-builds and serves
API docs for every published package by convention. Where a TS library has a dedicated
docs site, it is overwhelmingly TypeDoc-generated, directly or via
`typedoc-plugin-markdown` feeding another framework. Two dynamic hosts partially fill the
gap: [tsdocs.dev](https://tsdocs.dev) and [jsdocs.io](https://www.jsdocs.io) both run
TypeDoc against any published npm package on demand, so libtmux-ts likely gets an
automatic but broken page there once it ships to npm — TypeDoc's TS7 gap is not only our
problem.

libtmux.org adds what the convention can't: a page that actually renders, sharing
`sphinx-gp-theme`-derived tokens with the other seven ports, at `libtmux.org/ts/`, with
real versioning and one Pagefind-indexed search across all eight languages.

## Tool decision

### TypeDoc is a hard blocker, not a soft warning

TypeDoc 0.28.20's `package.json` declares
`peerDependencies.typescript = "5.0.x || ... || 6.0.x"`, and libtmux-ts pins
`typescript@7.0.2`. That mismatch alone is cosmetic — bun's installer and TypeDoc's own
`application.ts` only log a warning, they don't throw. The real blocker is structural:
TypeScript 7.0.2 is the "Corsa" Go-native rewrite, and its `package.json` maps the root
import to `lib/version.cjs`, a file exporting only `version` and `versionMajorMinor`. The
classic Compiler API is gone from the package — a search for `SyntaxKind` anywhere under
the installed `typescript` returns zero matches. TypeDoc crashes unconditionally at ESM
module-load time, before reading a single config flag: `typedoc --version` throws
`TypeError: Cannot read properties of undefined (reading 'PropertyDeclaration')`. No
flag or peer-dependency override recovers it — the code TypeDoc calls into no longer
exists in the package.

Tracked upstream at
[TypeStrong/TypeDoc#3098](https://github.com/TypeStrong/typedoc/issues/3098), "TypeScript
7 (TS-Go) support", open since 2026-04-24: the maintainer states the TS7 API is a
complete rewrite that TypeDoc's internals depend on in ways TS7 doesn't provide, no
timeline given (roughly 1-2 volunteer hours a week). A 2026-07-30 progress note puts
roughly 70 compiler errors remaining against a TS 7.1 nightly — worth revisiting, not
worth waiting on.

Everything built on TypeDoc inherits the crash, since each one calls into the same
broken module. `typedoc-plugin-markdown` subclasses TypeDoc's router classes and pins
`peerDependencies.typedoc = "0.28.x"`, so it never gets a model to convert.
`starlight-typedoc` is a thin `StarlightPlugin` wrapper shelling out to TypeDoc and
`typedoc-plugin-markdown` in an `astro:config:setup` hook — same crash, one layer up, and
moot twice over since the shell isn't Starlight. `sphinx-js` shells out to a real
`typedoc` binary (`sphinx_js/typedoc.py:60`) and checks only a minimum TypeDoc version
(`MIN_TYPEDOC_VERSION = (0, 25, 0)`), with no independent check against the installed
TypeDoc's own TypeScript ceiling — same failure, no workaround of its own.

### api-extractor works today, empirically confirmed

`@microsoft/api-extractor` 7.59.0 declares `"typescript": "5.9.3"` as a plain
(non-peer) `dependency` and `"peerDependencies": null`. It bundles its own compiler and
parses already-emitted `.d.ts` files rather than compiling source, so
`typescript@7.0.2` in the host project is never loaded. This was run end to end, not
just inferred from `package.json`: `bun run build` produced `packages/libtmux/dist/*.d.ts`,
and `api-extractor run --local` against that output printed `Analysis will use the
bundled TypeScript version 5.9.3` and `API Extractor completed successfully`, emitting a
936,568-byte `index.api.json` with warnings only (`ae-missing-release-tag`,
`ae-forgotten-export`, `ae-unresolved-link`), zero errors.

`packages/libtmux/dist/index.d.ts` re-exports from only 10 of the package's 13 non-root
subpaths — confirmed by reading the file directly: `client`, `pane`, `server`, `session`,
`window`, `selection`, `types`, `exc`, `common`, `constants` are re-exported at the root;
`engine`, `field-types` and `formats` are not. Full coverage needs four
`api-extractor.json` configs, not one, or the site silently drops three public entry
points.

`api-documenter markdown`, run against that same real 936 KB model, is a genuine
stopgap: it fragmented the roughly 13-export package into hundreds of one-member `.md`
files with inline HTML tables, and surfaced about 15 unresolved-`@link` warnings
(ambiguous overloads such as `Pane.plan`/`Session.plan`/`Window.plan`). It costs nothing
to run, but a hand-built Astro page per class beats one Markdown file per member.

`scripts/check-package-analysis.ts` already validates the surface api-extractor
consumes: it packs a real tarball and runs `publint run` and
`attw <tarball> --profile esm-only` against it in CI, so `exports`-map correctness and
type-resolution parity are checked before api-extractor reads the `.d.ts` rollup.

## The model, and what rendering must hand-build

`index.api.json`'s tree is `ApiModel → ApiPackage → EntryPoint → members[]`, each item
carrying `kind`, `canonicalReference` (e.g. `libtmux!Pane#sendKeys:member(1)`),
`releaseTag`, `fileUrlPath`, a raw `docComment` string, and `excerptTokens` — `Content`
and `Reference` pieces reconstructing the type signature, `Reference` pointing at
another item's `canonicalReference` for hyperlinking. `metadata.schemaVersion` (1011)
and `oldestForwardsCompatibleVersion` (1001) give an explicit compatibility floor,
unlike TypeDoc's JSON schema, which accepts exactly one version.

Because api-extractor renders nothing, an Astro template has to do what TypeDoc's
`DefaultTheme` would otherwise do for free: parse each raw `docComment` with
`@microsoft/tsdoc` and render the `DocNode` tree to HTML/MDX (`@param`, `@returns`,
`@example`, `{@link}`); splice `excerptTokens` back into a signature, turning
`Reference` tokens into links via their `canonicalReference`; turn `canonicalReference`
into a route ourselves, e.g. `libtmux!Pane#sendKeys:member(1)` →
`/ts/v0.1.0-alpha.7/api/pane/#sendkeys`; and build navigation from the `members[]` tree,
applying `overloadIndex`/`releaseTag` filtering — a no-op today, since no comment in the
repo carries `@public`/`@internal`/`@alpha`/`@beta` yet.

Astro's `file()` content-layer loader reads a JSON array or an id-keyed object, not a
nested `ApiModel` tree. The real work, per `24-astro-shell.md` §1.2, is a normaliser: a
script using `@microsoft/api-extractor-model`'s `ApiModel.loadPackage()` to walk all four
`.api.json` files and flatten them into one page-per-`ApiItem` array — that array is what
enters the content collection.

`generate-api-docs.ts` (`docs/api.md`) stays as the correctness gate regardless: it fails
on any unresolved `{@link}`, where api-extractor only warns — a strict doc-comment linter
against source versus a site-rendering feed against the compiled model, not
interchangeable.

## Shell contract

api-extractor produces no HTML, so most contract questions that apply to a skinned tool
(Rust, Go, Dokka, DocC) don't apply here — the "generator" is a JSON model, the "shell"
entirely our own Astro components.

| Contract point | api-extractor | Our Astro renderer |
|---|---|---|
| Base path | N/A — model has no baked links | Astro `base` per build, one build per version prefix (§2.3); `/ts/stable/` and `/ts/latest/` are separate builds, `canonical` set to the alias URL |
| Head injection | N/A | Ours — shared `BaseLayout.astro` `<head>`, no injection point needed since we own the file |
| Header / footer | N/A | Shared components loaded at runtime from a stable URL (§6), so chrome fixes reach published immutable versions without a rebuild |
| Machine-readable output | `*.api.json` (the model), `*.api.md` (unused) | `llms.txt`/`llms-full.txt` twins render from the same resolved content-collection entries the HTML pages use, not raw `docComment` again — see `10-llms-and-agents.md` |
| Native search | N/A | Pagefind crawls our rendered HTML; `data-pagefind-body` on the article is enough — no `exclude_selectors` fight, since we wrote the nav. Bundle lands at `/ts/pagefind`, merged per `08-search.md`'s `mergeIndex` |
| Template override | N/A — no template exists | We are the template — full design control, the actual cost of having no themable generator |

## Build command

Build the declarations first, from the project's own TypeScript 7 toolchain:

```console
$ bun run build
```

Then run api-extractor once per entry point not covered by the root barrel. These four
configs don't exist yet; add them under `packages/libtmux/etl/`:

```console
$ bunx --package @microsoft/api-extractor@7.59.0 -- api-extractor run \
    -c etl/api-extractor.index.json \
    --local
```

```console
$ bunx --package @microsoft/api-extractor@7.59.0 -- api-extractor run \
    -c etl/api-extractor.engine.json \
    --local
```

```console
$ bunx --package @microsoft/api-extractor@7.59.0 -- api-extractor run \
    -c etl/api-extractor.field-types.json \
    --local
```

```console
$ bunx --package @microsoft/api-extractor@7.59.0 -- api-extractor run \
    -c etl/api-extractor.formats.json \
    --local
```

Each config is the same shape, only `mainEntryPointFilePath` changes:

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/api-extractor/v7/api-extractor.schema.json",
  "projectFolder": "..",
  "mainEntryPointFilePath": "<projectFolder>/dist/index.d.ts",
  "projectFolderUrl": "https://github.com/<org>/libtmux-ts/tree/main/packages/libtmux",
  "apiReport": { "enabled": false },
  "docModel": {
    "enabled": true,
    "apiJsonFilePath": "<projectFolder>/etl/<unscopedPackageName>.api.json"
  },
  "dtsRollup": { "enabled": false },
  "tsdocMetadata": { "enabled": false }
}
```

`projectFolderUrl` turns each item's `fileUrlPath` into a clickable "view source" link —
worth setting even though nothing else in the config touches HTML.

## Where the output lands

The four `etl/*.api.json` files feed the normaliser, which writes flattened
content-collection entries the Astro build turns into static pages under
`s3://libtmux-docs/ts/v0.1.0-alpha.7/api/` (bucket and prefix per §7.3/§7.4), mirrored to
`/ts/stable/api/` and `/ts/latest/api/` as separate builds per §2.3. `--delete` in the
sync step is scoped to the `ts/` prefix only, never the bucket root, per §6.

## CI step

The build runs in `libtmux-ts`'s own CI as a satellite Astro build (per §7.7 — no
language's build lives in a shared monorepo job): `bun run build` → four
`api-extractor run --local` invocations → the normaliser → `astro build --site ...` →
`aws s3api put-object` with conditional writes as a backstop, under
`concurrency: {group, queue: max}` (§7.6). Invalidation touches only `/ts/stable/*`,
`/ts/latest/*` and the manifest, never the whole `/ts/*` root (§7.5).
`generate-api-docs.ts --check` runs as its own separate CI step and is what actually
fails the build on a broken `{@link}`.

`--local` is deliberate, not copied blindly from the spike: api-extractor's own success
computation is `errorCount === 0 && (localBuild || warningCount === 0)`
(`Extractor.ts`), so a non-local run fails on any warning — and the real spike produced
roughly 60 `ae-missing-release-tag` warnings (no source comment carries a release tag
yet) plus about 11 `ae-unresolved-link` warnings. `--local` keeps the step green today;
the alternative is setting
`messages.extractorMessageReporting["ae-missing-release-tag"].logLevel` to `"none"` once
that's a considered decision rather than a default.

## Open risks

- **api-extractor's TS7-independence isn't a permanent contract.** It works today because
  `.d.ts` emit syntax hasn't diverged under the TS7 rewrite — what broke was the internal
  compiler API, not declaration output — but that's Microsoft's stability choice, not
  ours. Re-verify on every TypeScript 7 minor release.
- **Four `.api.json` files, one package name.** All four carry `name: "libtmux"`.
  Whether `ApiModel` merges four `ApiPackage`s correctly, and whether cross-entry-point
  `{@link}` resolution (e.g. an `engine` comment linking to `Server`) finds the right
  package, is unverified — check against the real four-config output first.
- **The normaliser and the Astro templates don't exist yet.** This is the one port where
  "render the model" is greenfield work, not a config flag; budget it against the other
  seven ports' skin-and-inject work.
- **TypeDoc revisit trigger.** #3098 has an active fix in progress (~70 compiler errors
  remaining as of 2026-07-30). If it lands, TypeDoc's hook system beats hand-building
  every page — but switching back means redoing the routing work, a real cost.
