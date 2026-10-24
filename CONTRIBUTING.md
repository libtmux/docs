# Contributing

Contributions should fix a concrete documentation, rendering, or tooling
problem. Keep each change focused and describe its effect on readers.

Read [AGENTS.md](AGENTS.md) for repository boundaries and
[WRITING.md](WRITING.md) for prose, comments, and commit conventions.

## Setup

Use the Node requirement and pnpm version declared in `package.json`.
Shared dependency versions live in the `pnpm-workspace.yaml` catalog.

Install dependencies from the repository root:

```console
$ pnpm install
```

Start the Astro development server:

```console
$ pnpm dev
```

## Toolchain constraints

`@astrojs/check` accepts TypeScript 5 or 6 as a peer dependency. The site's
`astro check` and Astro language tooling depend on the compiler's language
service API; a compiler upgrade must preserve that integration. Follow the
TypeScript 6 constraint in [AGENTS.md](AGENTS.md#change-discipline).

The plain TypeScript packages extend the root `tsconfig.json`. The site
extends Astro's strict configuration instead. Keep both paths working when
changing shared compiler settings.

## Linting and formatting

`oxlint` is the workspace linter; `oxlint-tsgolint` supplies its type-aware
rules. Both are pinned centrally in the pnpm catalog. Package lint scripts
use `--type-aware` with their own `tsconfig.json`; the root command also runs
Oxlint over `scripts/`. Preserve each script's scope and exclusions.

Run lint across the workspace and build scripts:

```console
$ pnpm run lint
```

The theme package retains Biome in its formatting script; it is not the
workspace lint gate. This command writes changes, so review its diff:

```console
$ pnpm --filter @libtmux/theme format
```

## Checks

Run workspace type checks:

```console
$ pnpm run type-check
```

This runs `astro check` for the site and Oxlint's type-check mode for the
plain TypeScript packages. The theme also exposes `type-check:tsc` for a
direct compiler check; it is separate from the root gate.

Use the inner loop for cross-port mappings, native navigation, and native
asset normalization:

```console
$ pnpm test:inner
```

Run workspace unit suites, lint, API links, and generated mention/navigation
freshness checks in the medium loop:

```console
$ pnpm test:medium
```

Run the outer loop before committing:

```console
$ pnpm test
```

The outer loop includes the `*.outer.test.ts` integration suites, which seed
the full API catalog or exercise subprocess shutdown. It also adds type
checks and starts its own Astro development server
from current source. Browser checks cover prose, an MCP table, row permalinks,
API equivalents, and phone dropdown placement at 1440, 768, and 390 pixels. The
sampled renderer also checks homepage choices and uses
`node site/scripts/check-dev.mjs --sample`. It does not reuse `_site`. The
runtime budgets are under 2, 10, and 60 seconds for inner,
medium, and outer respectively; measure the complete pnpm command when
changing a loop. `test:fast` aliases medium. The runner stops an over-budget
loop and fails.

The medium and outer loops first stage the integrated Ruby and Lua guides
from local Git objects. Each revision comes from `site/src/data/api/<port>.json`;
the checkout's current branch and uncommitted files do not affect these guides.
Keep those repositories at their standard `checkout` paths in `ports.ts`, or
set `LIBTMUX_DOCS_CHECKOUT_RUBY` and `LIBTMUX_DOCS_CHECKOUT_LUA` to local clones
containing the required commits. Missing repositories or commits fail with
the required revision and environment variable. The gate does not fetch;
a fresh docs clone needs these source checkouts before `pnpm test`.

Browser checks use Playwright's installed Chromium by default. To use local
Chrome:

```console
$ LIBTMUX_DOCS_BROWSER_CHANNEL=chrome pnpm test
```

To keep local browser checks on a fixed port, stop the preview using that
port, then run:

```console
$ LIBTMUX_DOCS_BROWSER_PORT=53971 pnpm test
```

The value must be an integer from 1 to 65535. An occupied explicit port fails
the check instead of selecting another port. This setting also applies to
direct `check-dev.mjs` invocations, including `--serve`; without it, automated
checks select an available port and `--serve` uses 53971. Restart the shared
preview after the checks finish.

Install the pinned Chromium build for local browser checks with
`pnpm --filter @libtmux/site exec playwright install chromium`. CI installs
that build and its system dependencies before the publication audit.
The standard ten-second browser timeout increases to twenty seconds on CI.

Each engine aligns the sticky Members and group headings of a reference page
differently. The publication audit checks them in Chromium; install Firefox
and WebKit to check all three:

```console
$ pnpm --filter @libtmux/site exec playwright install firefox webkit
```

Then run the sticky heading check, which starts its own server and drives
focus, link, repeated link and typed hash arrivals in each engine:

```console
$ node site/scripts/check-dev.mjs --api-sticky
```

Kind marks centre their ink by measurement, and a legend chip, split chip or
modifier chip is one line of text. The badge gate reads the pixels of real pages
at 1x and at a real 2x device scale factor (Chromium launched with the factor,
because the emulated factor snaps text to CSS pixels), in light and dark. It
measures the mark that leads a name in cards and lists, the related-APIs
chips, the group headings, the MCP sidebar's rule (a mark only in a group that
mixes kinds, and no gutter) and that the API tree keeps its gutter, and it
checks that only the first mention of a name in a section carries a mark. A chip
grows with a name that wraps, so a related chip's mark is held flush with its
corner and as tall as the first line. The gate measures the Related APIs chips
on the Scala Server, Session, Window, Pane and Client pages at 1440 pixels,
where a name wraps onto several lines, and requires each chip to hold its name
and clear the next. Each check ends with a negative control that breaks what it
holds and requires the gate to notice, by the problem it names:

```console
$ node site/scripts/check-dev.mjs --badge-centring
```

Keep the complete assembly, all output suites, link audits, source/model
freshness, and full browser matrix in the publication audit:

```console
$ pnpm test:publication
```

This audit is not limited to 60 seconds. `scripts/test-all.sh` defines it;
`.github/workflows/test.yml` runs it in CI. Report skipped checks explicitly.
It runs the complete fresh-source browser matrix with
`node site/scripts/check-dev.mjs`, including every homepage language and detail
level, before assembly. The outer loop keeps only its bounded rendering sample.
Missing port checkouts, a missing local server, or a missing `shellcheck`
can leave publication checks unexercised. Development loops deliberately exclude assembled-output
suites; they do not establish publication readiness.

Add focused regression coverage for behavior changes and confirm that a new
check fails when its intended invariant is broken. Root policy-guide edits
need link, command, and diff review rather than new tests. Content edits
under `site/` still need the relevant rendering, example, and link checks.

### Theme test setup

`packages/theme/src/test-utils.ts` compiles CSS through the real Tailwind
plugin. Reuse it for output assertions. The package's `vitest.config.ts`
loads `src/test/setup.ts`, whose serializer normalizes only the Tailwind
version banner. Preserve that setup; changes to selectors or CSS structure
must remain visible in snapshots.

### Links between ports and guides

[`concepts.ts`](packages/api-model/src/concepts.ts) maps equivalent APIs by
their public symbol IDs. Check behavior and scope in each port's source
before adding a mapping. Record an absence when a port has no equivalent;
similar names alone do not establish one. An overloaded page can belong to
several concepts. The page dropdown and "In other ports" use these mappings,
and tests require every mapped target to resolve.

"Discussed in" comes from API mentions in guides, including tables and
sections headed with a port name. After editing those mentions, regenerate
the index:

```console
$ node scripts/gen-mentions.mjs
```

Workspace prose links a code span that names a CLI command, option or
configuration key to its entry in the port's CLI Manual or Configuration
reference. Those destinations come from an index of the workspace pages. After
adding or renaming a CLI page, a table of options, or a table of keys,
regenerate it:

```console
$ node scripts/gen-workspace-entities.mjs
```

A bare name links only on a user-facing workspace page, where it outranks a
library symbol or tmux name of the same spelling. `<program> <command>` links
on any page of a port that ships the program. Internals pages and the language
API index keep their library symbols.

The publication audit checks index freshness, rendered links, navigation targets,
and table layout at desktop, tablet, and phone widths.

### Header destinations

The port header links each repository, package page and API reference that
[`port-inventory.ts`](site/src/lib/port-inventory.ts) publishes. Two generated
files hold it to the facts. `site/src/data/manifest-packages.json` lists what
each port's owning manifests declare at the revision its API model is pinned to,
and the inventory's tests require the two to agree in both directions. After
changing an entry, or moving a port's pin, regenerate it from the local
checkouts:

```console
$ node scripts/gen-manifest-packages.mjs
```

A status in the inventory is a claim about a live host, so check it against the
host after changing an entry or when a package is released:

```console
$ node scripts/verify-destinations.mjs
```

The command requests each URL once, read-only. It requires the host's own
identity for the package, not only a 200; a repository that a registry reports
must be one of the entry's; and the version the manifest declares must be on
every host that lists versions, with the record saying so where one cannot. It
rewrites `site/src/data/destination-evidence.json`, which the unit tests and the
publication audit compare with the inventory offline. The command exits 1 when
a published destination fails or an unlinked one starts to answer; commit the
evidence with the inventory change that follows.

Age is enforced only where a live run is the remedy. Evidence older than
`EVIDENCE_MAX_AGE_DAYS` in `scripts/lib/destination-verification.mjs` makes the
offline comparison print a warning with the date of the records (a `::warning::`
annotation under GitHub Actions), and nothing more, so a change that touches none
of this does not fail because time passed. A live run ends by requiring every
record to be within the bound, and a record dated more than a day ahead is
refused wherever it appears, so evidence cannot be committed back-dated or
forward-dated. The weekly
[`verify-destinations.yml`](.github/workflows/verify-destinations.yml) runs the
live verifier into a temporary file and then
`node scripts/verify-destinations.mjs --check --fresh` against the committed
evidence; it fails on a destination that no longer passes or on evidence past
the bound, and is not a dependency of the test or deploy workflows
([CI](docs/ci.md#header-destination-check-verify-destinationsyml)).

### Standard-library and SDK destinations

A link into a language's own documentation, or into an SDK this estate builds
on, is held to more than a 200. [`api-destinations.mjs`](scripts/lib/api-destinations.mjs)
reads every one the site generates: the curated maps in
[`builtins.ts`](packages/api-model/src/builtins.ts), the cached inventories,
the references in the extracted doc comments, the links in pages, guide data
and the glossary. Each is requested once and must land on the page and the
fragment it names, and the page must document the symbol the link was made
for. A fragment must spell that symbol, and a member must sit on the page of
the type that owns it; text near the anchor does not count, because a CPython
entry names the types its neighbours take and a javadoc page lists the types it
inherits from. A page without a fragment must name the symbol in its title or
top heading, and where its address names a type, it must be that type. A host
that moves the page elsewhere fails, because a link should be the page's
address. Request the missing ones after changing a map, an inventory or
a pinned model:

```console
$ node scripts/verify-api-destinations.mjs --missing
```

The command is sequential and pauses between requests; it keeps fetched pages
for twelve hours (`--no-cache` asks again). A host that blocks the request,
throttles it or renders the page in the browser is recorded as unverifiable
with the reason and is never counted as passing; the offline check prints those
as unresolved. The cached inventories (CPython, Julia, the JDK and the web
platform) are checked whole against the index each host publishes:

```console
$ node scripts/verify-api-destinations.mjs --inventories
```

The evidence is `site/src/data/api-destination-evidence.json`. `--check`, which
the publication audit runs, requests nothing: it fails on a destination with no
passing record, a record for a link nothing makes, and a name that was never
checked against its page, or whose pass rests on an exception that is no longer
listed. Two reviewed lists in `scripts/lib/api-destinations.mjs` carry the
exceptions, each with its reason: `LISTED_ON_PAGE` for a name a page documents
beside its subject rather than in its title (`std::chrono::milliseconds` on the
`duration` page), and `SHARED_SECTIONS` for a page that documents several
symbols under one anchor (the Lua manual's value types, the typespec
reference), where the section the anchor opens must still hold the symbol. Add
to either only after reading the page. A name that a language spells another
way (`int` for `Int32`) goes in `TYPE_ALIASES`.
`scripts/verify-api-destinations.negative.mjs` plants a wrong fragment, a wrong
page, a symbol the page does not document and a redirect to a landing page on
pages shaped like CPython's, rustdoc's, Documenter's and javadoc's, and each
fault in the evidence, and requires the check to name each. The weekly
[`verify-destinations.yml`](.github/workflows/verify-destinations.yml) re-runs
the live check; pull requests never do.

## Building and previewing

Build the Astro shell:

```console
$ pnpm build
```

Assemble the complete site into `_site/`:

```console
$ pnpm build:site
```

Port inputs use the checkout and worktree locations in
`site/src/lib/ports.ts`. See [Adding a port](notes/adding-a-port.md) for
preparing docs-tooling worktrees and generator inputs.

Serve the assembled output with Python 3:

```console
$ ./scripts/serve.sh
```

The server listens at `http://localhost:8080`. Leave it running in another
terminal when running the publication audit to exercise browser checks. Style parity
also requires the generated Sphinx pages; check the run's skip summary.

Stop development and preview servers, then remove generated output and staging:

```console
$ pnpm run clean
```

Add `--dry-run` to list the directories or `--cache` to remove cached shell
and reference builds too. Cleanup shares the assembly lock and refuses to
run during an assembly. It preserves source, dependencies and `output/`
review evidence. Custom output and cache locations need their own cleanup.

## Pull requests

Keep commits focused on one topic. Explain the problem, resulting behavior,
and verification, including failures or skipped checks. Keep unrelated
cleanup in separate work.

Follow [WRITING.md](WRITING.md#commits) for commit messages and
[AGENTS.md](AGENTS.md#repository-boundaries) for push and deployment limits.
