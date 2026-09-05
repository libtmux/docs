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
attribution. Use sentence-case headings and preserve the capitalization of
TypeScript, .NET, C++, Astro, pnpm, Oxlint, and package names.

Delete introductions that only announce the paragraph. Replace "robust"
with the failure handled, "comprehensive" with the scope covered, and
"optimized" with a measured change and its reproduction conditions. Omit
"easily", "simply", "just", "please note", and unearned superlatives.
Use MUST, SHOULD, and MAY only for an intended normative requirement.

Describe the current behavior. Keep implementation deliberation and branch
history in commit messages. Explain tickets and decisions when referring to
them; an identifier alone is not context.

## Who you are writing for

The default reader uses libtmux in one language and needs to accomplish a
tmux task. Explain the shared model: server, session, window, pane. A docs
contributor needs the extraction and rendering details; put those in
contributor sections and link to them when needed.

- Lead with the concept and the reader's task before signatures or flags.
- Show the common call first, then useful variations, then lower-level APIs.
- State defaults and prerequisites early so readers know when they can stop.
- Name tradeoffs in observable terms: blocking, extra commands, cleanup,
  portability, or latency. Explain what the reader gains for that cost.
- Describe each port's actual semantics. Similar names do not prove matching
  behavior, defaults, errors, or async guarantees.

Use prose for explanations and sections for distinct ideas. Use lists for
steps or parallel facts; do not turn paragraphs into oversized bullets.
Tables suit stable comparisons and mappings, not command menus or stories.
Keep headings descriptive and stable so links and search remain useful.

## README and guides

The README gets a new reader from the project's purpose to a working local
site. Order it by what that reader needs:

1. What the site provides and who uses it.
2. Prerequisites and installation, checked against `package.json`.
3. The smallest working command and its expected result.
4. Defaults, output locations, and operational limits.
5. Links to contributor instructions and deeper architecture material.

Keep badges and architecture detail out of the path to first use. Link to
the guides that own setup or API details instead of maintaining a second
copy. State version and platform requirements where they affect a command;
verify any copied values against their source.

A task guide opens with the outcome, gives a runnable example, then explains
variations and failure handling. Describe what has completed when an async
operation returns, what the caller owns, and what needs cleanup. Keep
implementation details only when they affect a reader's choice.

## Documented examples that run

Use real public imports, valid names, and explicit prerequisites. Show
necessary error handling and cleanup. Avoid placeholders that a reader must
decode. Verify example code against the relevant port and version rather
than translating another port's spelling by analogy.

Prefer a tested source example to a manually copied snippet. This site's
[`remark-port-code.mjs`](site/src/plugins/remark-port-code.mjs) reads fences
with `file="..."` from its configured port checkout or docs worktree;
`region="..."` selects text between the source's region markers. Read that
plugin's mapping before editing an example source. Port mutations follow
[Repository boundaries](AGENTS.md#repository-boundaries).

Preserve source metadata, region markers, doctest prompts, and expected
output that a port's own tests collect. Edit generated examples at their
source. A fence that renders is not proof that its code runs:
[`example-sources.test.ts`](site/test/example-sources.test.ts) checks source
paths and a coverage floor, but it does not execute every language example.
It scans `.md` pages, not MDX, and cannot check source existence when the
relevant checkout is absent.

For inline examples, record the verification performed in the change's
review notes. Do not claim a code fence is executed merely because it has a
language tag. Preserve collected examples when changing their formatting.

### Examples across ports

Keep equivalent examples together under one task heading, using the actual
language fence tags. The site groups alternative ports into tabs; a build
for one port filters out the others. Language-specific lead-ins should stay
with their example. Separate sequential examples and distinct tasks with
their own explanation rather than forcing them into an alternatives group.

`console`, JSON, and other shared fences survive port filtering. Check that
shared setup still makes sense in every port's rendered page.

## Content collections and MDX

[`site/src/content.config.ts`](site/src/content.config.ts) owns collection
schemas. Handwritten `.md` and `.mdx` pages live in `site/src/content/docs/`;
staged API Markdown lives in `site/src/content/api/` and is generated.

The `docs` collection requires `title`; `description` is optional in the
schema, but add a useful description for new reader-facing pages. API
entries require `title` and `port`. Check the schema and the consuming
layout before adding fields: accepting a key does not make it render.

[`DocsLayout.astro`](site/src/layouts/DocsLayout.astro) renders the page's
title as its H1. Open the body with prose and use H2s for sections rather
than duplicating the title. Check heading anchors, the sidebar, and the
rendered table of contents after structural edits.

MDX uses this repository's components and layouts. Use standard Markdown
when no component is needed. Preserve translation provenance fields defined
by the schema; required metadata is distinct from conversational agent
attribution. Edit generated reference material through its source or
generator, not the staged output.

## API documentation

Use the language's established doc-comment syntax. In this workspace's
TypeScript, use TSDoc; describe Astro props on their `Props` interface.
Document exported API contracts at their declarations, leaving internal code
free of routine narration.

- Make the first sentence stand alone as a useful summary.
- Document units, ranges, empty values, ownership, mutation, ordering,
  blocking, completion, errors, and concurrency where relevant.
- Put option semantics on interface properties rather than repeating them
  in every function that accepts the interface.
- Name the error and triggering condition in `@throws`.
- Name the replacement in `@deprecated`; give a removal version only if one
  is established.
- Prefer resolvable symbol links supported by the renderer to copied URLs.
  Verify the rendered link instead of assuming a doc dialect works here.
- Keep public examples runnable and preserve their collection markers.

## Source comments

Keep a source comment only when it passes all three gates:

- **Loss:** Deletion would make a maintainer rediscover a constraint,
  invariant, failure mode, or non-obvious intent.
- **Quality:** A mature standard-library project would state it this
  directly, at this length, without arguing with an imagined reader.
- **Upkeep:** It stays true without manually synchronizing values owned by
  the code, such as counts, offsets, paths, or duplicated constants.

Aim for one or two lines and match the surrounding density. Split distinct
facts or cut deliberation before adding a long explanation. Keep frozen
external facts that explain a workaround; the upkeep gate targets values
that drift with our own code.

Keep upstream quirks, protocol constraints, ordering and lifetime rules,
concurrency requirements, and reasons that required code looks wrong. A
short algorithm sketch is useful when the local operations hide the whole.
Explain the constraint behind a cast, `@ts-expect-error`, or lint suppression.

Delete narration of the next lines, restated names or types, apologies,
speculative requirements, commented-out code, and history held by Git.
Prefer a better name to a comment explaining a confusing one. Do not delete
an invariant or workaround merely to meet a length target.

Minimal public API examples and parameter, return, and error guidance are
exempt from the loss gate, but must still be accurate, concise, and
maintainable. Preserve compiler directives, lint directives, region markers,
doctest prompts, and other text that tooling interprets.

## Error messages and help

Name the failed operation, the relevant input, and a corrective action when
one is known. Avoid empty messages such as "an error occurred", blame, and
speculative fixes. Keep published examples free of private paths and data.

Document defaults, units, empty-value semantics, filesystem effects, and
exit statuses where they affect using a script. Verify which stream carries
results and which carries diagnostics; do not invent a repo-wide convention
from one command. A skipped check must be described as skipped, not passed.

## Markdown and examples

Wrap prose at 80 columns, except tables and long links. Do not hard-wrap
GitHub issue or pull request paragraphs. Avoid personal information, email
addresses, and local absolute paths in published text.

Use ordinary Markdown for facts that must survive different renderers.
Reserve GitHub alert syntax for GitHub-only material and only when a warning
is necessary; the warning's text must stand alone. Put blank lines around
lists and headings, and preserve existing anchors when restructuring prose.

Code blocks are paste-and-run units:

- Put one command in each block. An explicit `&&`, `;`, or `\` chain counts
  as one command.
- Put explanations above the block, not in shell comments inside it.
- Give each command in a menu its own prose lead-in and block.
- Use `console` fences and a `$ ` prompt for shell commands.
- Split long commands with `\`, one flag or flag/value pair per continuation
  line, with positional arguments last.
- Verify commands against the repository's scripts and their actual inputs.

Run the workspace linter:

```console
$ pnpm run lint
```

### Durable links

Link to repository-relative files for local guidance. For external source
claims, prefer a release tag, then an unambiguous commit reachable from
trunk. Do not use a disposable PR-head revision. Use trunk links for living
documents and attach line anchors only to pinned revisions.

Preserve links, citations, anchors, and warnings while editing. Replace a
link's destination when its source moves; do not silently drop the evidence.
Link API mentions to their rendered reference when it exists and verify that
the destination belongs to the intended port and version.

## Review for slop

Judge information value, not authorship. Remove text that restates code,
sells the work, or requires knowledge of a branch's intermediate states.

- No tool signatures, conversational filler, or generated-by footers.
- No bare commit hashes, hard-coded line numbers, drifting counts, or
  copied version pins in general prose. Exact evidence belongs in a dated
  test result, lockfile, or pinned source citation.
- No invented rule codes or unexplained labels as a substitute for names.
- No ownerless TODOs, speculative scaffolding, or duplicate instructions.
- No change diary in README, API documentation, or user-facing guides.

Retain facts that explain a public contract, invariant, migration, or
upstream workaround. Apply this guide to the requested scope; it does not
authorize unrelated cleanup or rewriting shared history.

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
