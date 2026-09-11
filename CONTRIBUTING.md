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

Run every workspace source suite, lint, and generated mention/navigation
freshness checks in the medium loop:

```console
$ pnpm test:medium
```

Run the outer loop before committing:

```console
$ pnpm test
```

The outer loop adds type checks and starts its own Astro development server
from current source. Browser checks cover prose, an MCP table, API equivalents,
and phone dropdown placement at 1440, 768, and 390 pixels. The sampled renderer
does not reuse `_site`. The runtime budgets are under 2, 10, and 60 seconds for inner,
medium, and outer respectively; measure the complete pnpm command when
changing a loop. `test:fast` aliases medium. The runner stops an over-budget
loop and fails.

Browser checks use Playwright's installed Chromium by default. To use local
Chrome:

```console
$ LIBTMUX_DOCS_BROWSER_CHANNEL=chrome pnpm test
```

Keep the complete assembly, all output suites, link audits, source/model
freshness, and full browser matrix in the publication audit:

```console
$ pnpm test:publication
```

This audit is not limited to 60 seconds. `scripts/test-all.sh` defines it;
`.github/workflows/test.yml` runs it in CI. Report skipped checks explicitly.
Missing port checkouts, a missing local server, or a missing `shellcheck`
can leave publication checks unexercised. Development loops deliberately exclude assembled-output
suites; they do not establish publication readiness.

Run the port examples these docs quote against a tmux server the docs own:

```console
$ pnpm test:arena
```

`scripts/docs-arena.mjs` starts tmux itself with `-D -S` and an empty
config, lends that server to each port's arena adapter in the
`<checkout>-tmux-arena` worktree beside the port's checkout, and requires
one `LIBTMUX_ARENA_EVIDENCE` record naming the server's live challenge, PID,
and socket. It then withholds the socket and requires the adapter to fail
without evidence and without reaching any other server. A port without its
worktree or toolchain is reported as not run; `--require` makes that a
failure, and `--port <slug>` selects ports. The publication audit runs only
the supervisor's negative checks, which need tmux alone, unless
`LIBTMUX_DOCS_ARENA=1`.

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

The publication audit checks index freshness, rendered links, navigation targets,
and table layout at desktop, tablet, and phone widths.

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

## Pull requests

Keep commits focused on one topic. Explain the problem, resulting behavior,
and verification, including failures or skipped checks. Keep unrelated
cleanup in separate work.

Follow [WRITING.md](WRITING.md#commits) for commit messages and
[AGENTS.md](AGENTS.md#repository-boundaries) for push and deployment limits.
