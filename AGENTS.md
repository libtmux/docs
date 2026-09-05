# AGENTS.md

libtmux.org: the unified documentation site for the libtmux language ports.
A pnpm workspace with an owned Astro shell, API extraction, and a Tailwind
theme plugin.

Follow the conventions already in the tree, and keep changes scoped to the
requested work.

## Which policy applies

- Environment, Oxlint, formatting, tests, and pull requests:
  [CONTRIBUTING.md](CONTRIBUTING.md).
- Documentation, user-facing text, comments, and commits: [WRITING.md](WRITING.md).

Each guide is the single home for its subject.

## What is here

| Path | What it owns |
| ---- | ------------ |
| `site/` | Astro layouts, components, content, and reference pages. |
| `site/src/lib/ports.ts` | Port identities, repositories, renderers, and checkout/worktree locations. |
| `site/src/lib/versions.ts` | Version types, build identity, canonical URLs, and robots policy. |
| `packages/api-model/` | API extraction and the shared reference model. |
| `packages/theme/` | The Tailwind theme plugin, consumed as TypeScript source. |
| `scripts/` | Site assembly, generated data, and validation. |
| `infra/` | Hosting configuration and deployment notes. |
| `notes/` | Architecture and port integration guidance. |

Read the port and version modules before trusting summaries of them.
`notes/research/00-DECISIONS.md` governs its research folder; implementation
facts come from the code.

## Change discipline

- Make the smallest coherent change that solves the verified problem.
- Reuse existing files, helpers, components, and tests before adding new ones.
- Add files for distinct responsibilities or independent reuse, not one-line
  re-exports or single-use helpers.
- Keep port and version decisions in their existing shared modules.
- Use owned Astro components; do not adopt Starlight, Docusaurus, or another
  documentation framework. Extend the shell with small integrations, as in
  `site/src/integrations/pagefind.ts`.
- Keep TypeScript on the workspace's 6.x catalog entry; do not bump it to 7.
  See [Toolchain constraints](CONTRIBUTING.md#toolchain-constraints).

## Repository boundaries

This repository's push remote is `tony`. Never push to a port repository
from this repository's work. Commit port docs-tooling changes on that port's
`docs-site` worktree branch and hand them to the maintainer for review and
publication. Keep those worktrees alongside their normal checkouts, using
`checkout` and `worktree` in `ports.ts`.

Scope `aws s3 sync --delete` to one job's own prefix, never a bucket root or
an entire language root.

## References

- [README.md](README.md)
- [Architecture](notes/architecture.md)
- [Adding a port](notes/adding-a-port.md)
