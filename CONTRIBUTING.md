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

## Checks

Run lint across the workspace and build scripts:

```console
$ pnpm run lint
```

Run workspace type checks:

```console
$ pnpm run type-check
```

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

Oxlint is the linter. Biome is used by the theme package's format script.
Add focused regression coverage for behavior changes and confirm that a new
check fails when its intended invariant is broken. Documentation-only edits
need link, command, and diff review rather than new tests.

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
