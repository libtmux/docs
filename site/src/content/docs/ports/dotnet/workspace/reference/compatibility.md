---
title: "tmuxp compatibility and port status"
description: "Current local CLI capabilities, remaining gaps, and the historical builder audit."
port: dotnet
product: workspace
sidebar:
  label: "tmuxp compatibility and port status"
  group: "Reference"
  order: 30
tableOfContents: true
---

**Local implementation, unpublished.** The .NET `tmux-workspace` CLI
is available in the `workspace-cli` source worktree. Its command and
configuration coverage remains partial. See [installation](../../guides/installation/)
for local setup; installing a published library does not establish availability
of this CLI.

Compatibility targets useful tmuxp 1.74.0 commands and workspace workflows, with
native validation, execution and output conventions. Matching command names does
not promise identical runtime behavior or Python semantics.

## This port

Native services cover load, capture, discovery, search, conversion, both
importers, editor execution and diagnostics on Unix. Loading creates or reuses
an exact session name. Append authenticates the inherited daemon and selected
endpoint, resolves the pane's current session through tmux and retains that
session across all inputs. Moving the pane does not redirect later inputs;
the session suffix in `TMUX` does not select the destination. Later commands,
including global options after a script, reject a replacement daemon. Failure
preserves the borrowed session. A session-name override applies to the final
input. Partial results identify completed inputs and retained changes.

The normalizer supports command shorthand, inherited commands, enter/delay
settings, history suppression, directories, environment, shells, layouts,
indexes, focus and options. Before-scripts run direct argv after session
creation, from the explicit session directory or invocation directory. Failure
removes only the created session. Blank panes skip readiness work. Capture
retains topology, directories, window options and current command names, but
cannot recover original arguments, history, hooks or plugin state.

Every command accepts `--json` and `--ndjson`; NDJSON takes precedence. Machine
load requires `-d` or explicit append and never prompts. Machine document
commands avoid guessed output filenames. `--save-to` selects a destination and
`--force` permits replacement through atomic publication. Human output uses
semantic colors, with machine diagnostics on stderr. Search uses native .NET
regular expressions with a one-second match timeout.

Human `ls --full` shows windows, layouts and each pane's first command in a
tree. Literal markup and terminal controls remain escaped. JSON retains the
full decoded configuration.

Native load rejects `-8` and `--88-colors` before reading workspace files or
running tmux or Python. Supported tmux versions cannot provide 88-color mode;
use `-2` for 256 colors.

`--log-level` filters optional warnings and file records without suppressing
command errors. On Linux x64, `load --log-file` appends structured logs and
rejects unusable destinations before tmux or Python runs. A later file failure
disables logging and remains secondary to the workspace result, error or
cancellation. See [output](../output/) for levels and file restrictions.

Human load renders terminal progress on stderr on Linux x64. Presets and bare
named token templates track configured windows and panes. Pane completion means
commands were delivered and configured delays elapsed, not that shell commands
finished. Script panels retain a bounded tail; disabling the panel preserves
the original stdout/stderr destinations. Resizing stops drawing and leaves the
old frame in place. See [load](../../cli/load/#progress-and-script-output).

Python shell and workspace extensions use a checked tmuxp 1.74.0 runtime
selected by `TMUX_WORKSPACE_PYTHON`. Append with Python plugins or custom
builders fails before building any input or starting Python; use `-d` to load
those extensions into a separate session. Empty `plugins: []` and a null
`workspace_builder` remain native. Child stdout and stderr are captured
separately with bounds and explicit truncation. The parser generates Markdown,
command metadata, a manual and static Bash/Zsh/Fish completion definitions.

The local source reference is src/LibTmux.Workspace.Cli/README.md. Use the
native executable's `--help` for the options implemented in that checkout.

### Remaining gaps

- Interactive confirmation policies remain incomplete. Progress drawing is
  limited to Linux x64 and does not redraw after a terminal resize.
- .NET Console initialization can emit keypad controls when stdout is a
  terminal. Console writes do not have a hard cancellation deadline; see
  [output](../output/).
- Attached load, client switching and controlling-terminal editor/shell
  behavior need the remaining real terminal and interruption gates.
- Python plugin loading delegates the whole load rather than preserving native
  per-input accounting. Optional backends and extension lifecycle coverage
  remain incomplete.
- Contextual completion, YAML alias/depth and configuration corpus coverage,
  full capture and platform/package acceptance remain open.

## Historical builder audit

Audit date: 2026-09-09. [Native source snapshot](https://github.com/libtmux/libtmux-dotnet/tree/b71b9654f41785c93717e454cbf176672b3d634a).
The following results describe that original library revision, before the local
CLI implementation. They are historical evidence, not its current capability
list or a support guarantee for a published artifact.

The library parsed 7 upstream YAML examples in the original audit. Existing
builder tests passed, but full normalization, command services and capture were
incomplete. Window options were applied after commands. The source snapshot had
no native CLI.

At that baseline, `LibTmux.Workspace` rejected unknown or duplicate keys and
unsupported value shapes. Its parser and builder covered a subset, and build
errors could expose a partial result without automatic rollback. Those
historical library results are separate from current CLI validation and owned
session cleanup.

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

Python libtmux exposes `LIBTMUX_TMUX_FORMAT_SEPARATOR` in its format collector.
This native CLI does not claim that setting as a supported codec control. Its
framing and decoding need their own compatible seam and collision, empty value,
Unicode and line-break checks before accepting such a setting.

## Reading examples

The [gallery](../../examples/gallery/) contains the upstream fixture corpus.
Parsing a fixture and executing its applications are separate checks. Several
require external programs, remote hosts, project directories or plugin
packages. A successful YAML read does not establish those dependencies or the
complete workspace behavior.

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
