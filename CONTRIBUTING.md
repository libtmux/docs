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

Run the fast checks while iterating:

```console
$ pnpm run test:fast
```

This skips assembly and output checks. Run the full gate for changes to
rendering, reference extraction, links, or build behavior:

```console
$ pnpm test
```

`scripts/test-all.sh` defines the checks; `.github/workflows/test.yml`
defines their CI environment. Report skipped checks explicitly. Missing port
checkouts or a missing local server can leave checks unexercised.

Add focused regression coverage for behavior changes and confirm that a new
check fails when its intended invariant is broken. Documentation-only edits
need link, command, and diff review rather than new tests.

### Theme test setup

`packages/theme/src/test-utils.ts` compiles CSS through the real Tailwind
plugin. Reuse it for output assertions. The package's `vitest.config.ts`
loads `src/test/setup.ts`, whose serializer normalizes only the Tailwind
version banner. Preserve that setup; changes to selectors or CSS structure
must remain visible in snapshots.

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
terminal when running the full gate to exercise browser checks. Style parity
also requires the generated Sphinx pages; check the run's skip summary.

## Pull requests

Keep commits focused on one topic. Explain the problem, resulting behavior,
and verification, including failures or skipped checks. Keep unrelated
cleanup in separate work.

Follow [WRITING.md](WRITING.md#commits) for commit messages and
[AGENTS.md](AGENTS.md#repository-boundaries) for push and deployment limits.
