# Writing

This guide governs documentation, user-facing text, content frontmatter,
source comments, and commit messages. For setup, checks, and pull requests,
see [CONTRIBUTING.md](CONTRIBUTING.md).

## Voice

Lead with the conclusion or observable behavior. Use active voice, present
tense, concrete nouns, and short sentences. Assume the reader knows their
language but is new to this project. Explain project semantics rather than
restating types or signatures.

Keep identifiers in backticks and use stable names for ports, versions,
renderers, and packages. Avoid filler, marketing claims, emojis, and agent
attribution. Quantify performance claims or omit them.

Describe the current behavior. Keep implementation deliberation and branch
history in commit messages. Explain tickets and decisions when referring to
them; an identifier alone is not context.

## Source comments

Comments explain constraints, invariants, upstream quirks, and tradeoffs
that the code cannot express. Match the surrounding density; one or two
lines usually suffice.

Before keeping a comment, ask whether deletion loses useful information,
whether the text states a precise fact, and whether it stays true without
manual synchronization. Remove narration, restated types, speculative
requirements, and history already recorded by Git. Preserve the constraint
behind a workaround even when trimming its explanation.

Public API usage examples and parameter, return, and error documentation
serve callers; keep them concise and accurate.

## Markdown and examples

Wrap prose at 80 columns, except tables and long links. Do not hard-wrap
GitHub issue or pull request paragraphs. Avoid personal information, email
addresses, and local absolute paths in published text.

Code blocks are paste-and-run units:

- Put one command in each block. An explicit `&&`, `;`, or `\` chain counts
  as one command.
- Put explanations above the block, not in shell comments inside it.
- Use `console` fences and a `$ ` prompt for shell commands.
- Split long commands with `\`, one flag or flag/value pair per continuation
  line.
- Verify commands against the repository's scripts and their actual inputs.

Run the workspace linter:

```console
$ pnpm run lint
```

Link to repository-relative files for local guidance. For external source
claims, prefer a release tag, then a commit reachable from trunk. Use trunk
links for living documents. Attach line anchors only to pinned revisions.
Avoid duplicated counts, version pins, and status claims that silently drift
from the code that owns them.

## Commits

Use the no-colon scoped form used by the sibling TypeScript projects:

    type(scope[detail]) Concise description

    why: Reason for the change.

    what:
    - Specific changes needed to address it

Aim for a 50-character subject; treat 72 as the practical limit. Wrap body
lines at 72 and separate `why:` and `what:` with a blank line. A small,
self-explanatory change can use a subject alone.

Use `docs` for documentation and `ai(rules[AGENTS])` or `ai(rules[claude])`
for agent entry points. Make the subject describe the actual change. Commit
history carries the rationale; shipped prose describes the resulting state.

Keep each commit reviewable and include verification appropriate to its
scope. Do not add tool signatures or invented pull request provenance.
