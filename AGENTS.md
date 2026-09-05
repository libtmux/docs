# AGENTS.md

libtmux.org: the unified documentation site for every libtmux language port.
A pnpm workspace holding an owned Astro 7 shell (`site/`) and the Tailwind v4
theme plugin it uses (`packages/theme/`), plus the not-yet-populated loaders,
infra, and build scripts that will turn eight ports' worth of generated
reference output into one site.

Follow the conventions already in the tree, and keep a change scoped to what
was asked for.

## What is here

| Path | What it is |
| ---- | ---------- |
| `site/` | The Astro shell: landing, concepts, guides, examples, parity, search, and the two ports (TypeScript, .NET) this app renders directly. `site/src/lib/ports.ts` and `site/src/lib/versions.ts` are the source of truth for ports and the version axis — read them before trusting a summary of them, this file included. |
| `packages/theme/` | `@libtmux/theme`, the Tailwind v4 theme plugin, ported from `~/work/typescript/tony.sh`. Consumed as TypeScript source via `workspace:*`. |
| `ingest/`, `infra/`, `scripts/` | Reserved, not yet populated: content-collection loaders, CloudFront/bucket infra, and the whole-site build script (`scripts/build-site.sh`, called by the root `build:site` script). |
| `notes/architecture.md` | What the shell, the three renderers, the version axis, the SEO model, and search actually do, per the committed code — and where the surrounding prose disagrees with it. |
| `notes/adding-a-port.md` | The checklist for adding a ninth port. |
| `notes/research/` | The design research this repo's architecture was decided from. `00-DECISIONS.md` is its own authoritative file for *that folder*; it is not authoritative over the actual code once the two diverge — `notes/architecture.md` tracks where they do. |

## No documentation framework

No Starlight, no Docusaurus, no framework of any kind. Astro is a build tool
and a component model; every layout and component under `site/src/` is ours
to change. If a capability seems to require adopting one, that's a signal to
write the small amount of code ourselves — the site's own Pagefind
integration (`site/src/integrations/pagefind.ts`, ~35 lines) is the standing
example of how little that usually costs.

## TypeScript 6, not 7

The workspace catalog pins `typescript: ^6.0.3`
(`pnpm-workspace.yaml`) — do not bump it to 7. `@astrojs/check` peer-caps at
`^6`, and TypeScript 7's Go-native compiler rewrite doesn't yet expose the
language-server host API `astro check` and the Astro language server depend
on: bumping breaks type-checking, not just a peer-dependency warning.

## Lint and format

`oxlint` (+ `oxlint-tsgolint` for type-aware rules) is the linter everywhere,
pinned once in the workspace catalog. One command covers the whole repo,
including the build scripts, which is where most of this project's bugs have
actually lived:

```console
$ pnpm run lint
```

Biome survives only as `packages/theme`'s `format` script — it is a formatter
there, not a linter, and oxlint took over that package's `lint` when the
tony.sh port's loose ends were swept up.

Three of those loose ends were load-bearing and had been failing silently:
the root `tsconfig.json` that `packages/theme/tsconfig.json` extends did not
exist (so both its `lint` and `type-check` died before reading a file),
`src/test-utils.ts` was never copied across (three of four test suites could
not import), and the vitest snapshot serializer that absorbs Tailwind's
version banner came with neither a config nor a setup file (eight snapshots
failing on `v4.3.3` against a recorded `vx.y.z`). 8 of 36 theme tests ran
before that; all 36 do now.

## Push policy

This repo's own push remote is `tony`. The eight (soon nine) **port
repositories are public** — `tmux-python/libtmux`, `libtmux/libtmux-ts`, and
so on, per `repo` in `ports.ts` — and an agent working from this repo must
**never push to any of them**. Docs-tooling changes for a port (a CI caller
workflow, an injected header/footer fragment, a generator config) get
committed on that port's own `docs-site` worktree branch and handed to the
maintainer as something to review and push or open as a PR — never pushed
directly from here. See `notes/adding-a-port.md` step 5 for the concrete case
this applies to.

## Worktree layout

Each port's docs-tooling work happens on a `docs-site` branch, checked out as
a worktree alongside (never inside) that port's normal checkout — one
directory per language, matching `checkout`/`worktree` in `ports.ts`:

| Port | Checkout | Worktree |
| ---- | -------- | -------- |
| Python | `~/work/python/libtmux` | `~/work/python/libtmux-python-docs` |
| TypeScript | `~/work/libtmux/libtmux-ts` | `~/work/libtmux/libtmux-ts-docs` |
| Rust | `~/work/libtmux/libtmux-rs` | `~/work/libtmux/libtmux-rs-docs` |
| Go | `~/work/libtmux/libtmux-go` | `~/work/libtmux/libtmux-go-docs` |
| Java/Kotlin | `~/work/libtmux/libtmux-java` | `~/work/libtmux/libtmux-java-docs` |
| .NET | `~/work/libtmux/libtmux-dotnet` | `~/work/libtmux/libtmux-dotnet-docs` |
| C++ | `~/work/libtmux/libtmux-cxx` | `~/work/libtmux/libtmux-cxx-docs` |
| Swift | `~/work/libtmux/libtmux-swift` | `~/work/libtmux/libtmux-swift-docs` |

Python is the one exception to the `~/work/libtmux/` pattern — it lives under
`~/work/python/` because that's where the port repository itself is checked
out.

## Change discipline

- Make the smallest coherent change that solves the verified problem; keep
  unrelated cleanup out of it.
- Reuse an existing file, helper, or component before adding a new one —
  `ports.ts` and `versions.ts` exist so no other file needs a per-port or
  per-version `if`.
- Add a file only for a durable boundary — a distinct responsibility,
  independent reuse, or splitting an oversized module — not for a
  single-use helper or a one-line re-export.
- Never scope an `aws s3 sync --delete` to anything wider than the one job's
  own prefix; the bucket root and a whole language root are both wrong (see
  `notes/adding-a-port.md` step 5).

## Comment style

Comments explain **why**, not what — the decision, the constraint, or the
tradeoff a future reader can't get from the code itself, not a restatement
of the line below it. Match the density of the file you're editing: a
one-line rationale where the surrounding file uses one, a short paragraph
where it uses a short paragraph. No emojis, in comments or anywhere else in
this repo. Technical prose only.

In any Markdown written here (this file included): one command per fenced
code block, comments outside the fence, shell commands as ` ```console` with
a `$ ` prompt, long commands split with `\` and one flag per continuation
line.

## References

- [README.md](README.md)
- Architecture: [notes/architecture.md](notes/architecture.md)
- Adding a port: [notes/adding-a-port.md](notes/adding-a-port.md)
- Design research: `notes/research/00-DECISIONS.md` (authoritative for that
  folder only — see the note on it in "What is here" above)
