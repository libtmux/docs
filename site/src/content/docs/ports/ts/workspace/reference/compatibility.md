---
title: "tmuxp compatibility and port status"
description: "Current local CLI capabilities, remaining gaps, and the historical builder audit."
port: ts
product: workspace
sidebar:
  label: "tmuxp compatibility and port status"
  group: "Reference"
  order: 30
tableOfContents: true
---

**Local implementation, unpublished.** The TypeScript `tmux-workspace` CLI
is available in the `workspace-cli` source worktree. Its command and
configuration coverage remains partial. See [installation](../../guides/installation/)
for local setup; installing a published library does not establish availability
of this CLI.

Compatibility targets useful tmuxp 1.74.0 commands and workspace workflows, with
native validation, execution and output conventions. Matching command names does
not promise identical runtime behavior or Python semantics.

## This port

The CLI runs on Node.js and Bun. Native services cover detached load, exact
session reuse, append, capture, discovery, search, conversion, both importers,
editor execution and diagnostics. Attached load uses the controlling terminal
and selects its tmux client before building; unavailable terminals fail before
session creation. Append authenticates the inherited server and current pane. A
failed native bootstrap removes its created session and preserves a borrowed append
session. Other failures report completed objects and the failed stage.

Native loading supports command settings, directories, environment, shells,
layouts, explicit window indexes, focus, options and before-script execution.
Blank panes skip readiness checks. Conversion preserves extension fields;
explicit saves require `--force` to replace an existing file. Capture recovers
live state but cannot recover original command arguments, history or plugin
intent. Native JavaScript regular expressions power search.

Capture accepts an explicit session name or ID, authenticated tmux context, or
the only live session. Multiple sessions without context require an explicit
target. A `.json` destination selects JSON unless `-f` overrides it; other
destinations default to YAML. `--quiet` suppresses human save status while
preserving machine results.

Every command accepts `--json` and `--ndjson`; NDJSON takes precedence. Machine
load requires `-d` or `--append` and never prompts. Human output has semantic
colors and terminal progress with preset or custom formats. Log levels filter
diagnostics, and `load --log-file` records them separately from result output.
Child streams are bounded, escaped and streamed in NDJSON. `load -2` selects
256-color mode; `-8` fails before workspace lookup or tmux access.

Python `shell` and explicit plugin/custom-builder loads require tmuxp 1.74.0 in
the interpreter selected by `TMUX_WORKSPACE_PYTHON`, defaulting to `python3`.
An interactive shell needs a controlling terminal. Ordinary loads and native
read commands do not start Python. Empty plugin lists and blank builder names
stay native.

The load adapter expands common fields and resolves existing import directories
relative to the workspace file. Explicit custom builders may omit `windows`.
Append retains its authenticated target across inputs and rejects Python
`before_script`. Extension progress shows a workspace label and script output
without native pane counters.

Extension results report `effects_scope: "observed"`, `effects_unknown: true`,
and newly observed window and pane IDs. Concurrent changes may appear in these
observations; the CLI does not infer ownership or roll back extension effects.
Cancellation stops the owned Python process group, then allows up to one second
to observe surviving topology. A daemon change or failed observation is reported
without comparing IDs across daemon lifetimes.

Native command references and Bash, Zsh and fish completion are generated from
the parser. `completion` prints the selected shell script; machine modes return
a structured script result. Static completion covers commands, options, enum
values and file paths without running the CLI. Saved workspace names and live
session values are outside its scope. Linux checks use Bash 5.2, Zsh 5.9 and
fish 4.8; older shells and newline filenames remain unverified.

Bare root/import groups in machine modes return a structured usage error with
status 2 and empty stdout. Explicit help requests still print help.

The local source reference is packages/workspace-cli/README.md. Use the native
executable's `--help` for the options implemented in that checkout.

### Remaining gaps

- Interactive confirmation prompts remain unfinished.
- Complete configuration/importer coverage, recoverability-aware capture and
  platform acceptance remain open. Local installed-package checks on Node and
  Bun do not establish support for every platform or workspace example.

## Historical builder audit

Audit date: 2026-09-09. [Native source snapshot](https://github.com/libtmux/libtmux-ts/tree/f85b8de551353f746d50eaf36bf0112f4fe5a528).
The following results describe that original library revision, before the local
CLI implementation. They are historical evidence, not its current capability
list or a support guarantee for a published artifact.

The library parsed 8 upstream YAML examples in the original audit. Its
reconciliation builder could remove existing windows and panes, unlike tmuxp
load policy. Capture/replay preserved the measured topology and directories, but
was not a complete freezer. The source snapshot had no native CLI.

At that baseline, `@libtmux/workspace` validated a strict subset. Its apply
operation used ownership and command policies. Its YAML helper required Bun;
Node callers needed a separate YAML decoder. These library observations do not
describe the current CLI's YAML support or loading policy.

Read the port's [builder topics](../../internals/topics/) and
[API](../../internals/api/) for its library interface. Use the language switcher
to compare the same topic across ports; each port has its own coverage limits.

## Shared gaps

Parser acceptance does not prove execution support. Native regex engines and
Python plugin runtimes have different contracts; identical flags alone do not
establish compatibility. See [shell](../../cli/shell/),
[search](../../cli/search/) and [hooks](../../configuration/hooks/), and apply
this port's current limitations above when reading those reference pages.

## Optional format separator

The TypeScript library reads `LIBTMUX_TMUX_FORMAT_SEPARATOR` when importing its
`FORMAT_SEPARATOR` constant for direct format-list consumers. The workspace
CLI's snapshot codec uses separate guarded framing; this setting does not change
that transport or its decoding.

## Reading examples

The [gallery](../../examples/gallery/) contains the upstream fixture corpus.
Parsing a fixture and executing its applications are separate checks. Several
require external programs, remote hosts, project directories or plugin
packages. A successful YAML read does not establish those dependencies or the
complete workspace behavior.

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
