---
title: "tmuxp compatibility and port status"
description: "Current local CLI capabilities, remaining gaps, and the historical builder audit."
port: swift
product: workspace
sidebar:
  label: "tmuxp compatibility and port status"
  group: "Reference"
  order: 30
tableOfContents: true
---

**Local implementation, unpublished.** The Swift `tmux-workspace` CLI
is available in the `workspace-cli` source worktree. Its command and
configuration coverage remains partial. See [installation](../../guides/installation/)
for local setup; installing a published library does not establish availability
of this CLI.

Compatibility targets useful tmuxp 1.74.0 commands and workspace workflows, with
native validation, execution and output conventions. Matching command names does
not promise identical runtime behavior or Python semantics.

## This port

Native services cover load, append, capture, discovery, search,
conversion, both importers, editor execution and diagnostics. Loading creates
sessions or reuses exact names. Append authenticates the inherited server PID,
selected endpoint and current pane; failure preserves the borrowed session and
reports new windows and potentially changed settings. A failed new build removes
only its created session and reports earlier successful workspaces.

Loading supports pane shorthand, inherited commands, sequential enter settings,
history suppression, directories, layouts, indexes, focus, session environment
and session/window options. Before-scripts run direct argv after session
creation, from the expanded session directory or invocation directory. All input
documents are validated before creation, including expanded session names and
NUL rejection. Unsupported execution keys fail explicitly. Outside tmux, load
currently requires an explicit `-S` or `-L` endpoint. Append uses new slots and
ignores configured indexes.

Human load with a foreground terminal attaches to the final workspace. Inside
tmux, a prompt offers switching, detached loading, appending or cancellation.
`-y` skips that mode prompt but refuses an ambiguous client selection. All
inputs are validated before prompting. Redirected and machine calls require
`-d` or `--append` and never prompt. Detaching or interrupting the attached
client preserves loaded workspaces and restores terminal settings.

Switching checks the selected server, pane terminal and client's current PID,
session and globally active pane. A client with independent `active-pane`
focus on the invoking pane's physical window prevents switching; detached
and append choices remain available. Independent clients on other windows do
not block switching. If the selected client gains the flag before handoff,
the switch fails and the loaded workspace remains.

A tmux client name can be reused after that check; outside
attachment likewise checks the server before starting the terminal client.
These checks do not make the separate attachment process atomic with a server
restart or client replacement.

`load -2` forces 256-color handling in direct and control clients, together with
any explicit tmux configuration file. Legacy `-8` is recognized but rejected
before document lookup or backend access; supplying both flags is a usage
error. Without `-2`, tmux detects color support.

YAML requires the `YAMLWorkspaces` build trait. Conversion preserves extension
fields, and both importers require an explicit source. Import warns about
untranslated fields and rejects ERB. Optional saves publish files atomically;
`--force` permits replacement. Capture records current commands, directories,
window names, indexes, focus, layouts, local session/window options and session
environment values. It cannot recover original arguments, scripts or plugin
intent. Removed environment entries and global options are omitted. Values are
captured literally; loading a capture applies normal tmuxp-compatible variable
expansion. Search uses native ICU regular expressions without Python.

Capture selects an explicit session name or ID, then authenticated tmux context,
then the only live session. Ambiguous human calls offer a choice; machine calls
require an explicit target. A `.json` destination selects JSON unless `-f`
overrides it; other destinations default to YAML. `--quiet` suppresses human
status and warnings while preserving machine results and required errors.

Every command accepts `--json` and `--ndjson`; NDJSON takes precedence. Listing
and search decode documents on demand; load emits sequenced events and one
terminal result while its output stream remains writable. Human listing uses
semantic colors and escapes terminal controls. Editor argv is passed directly;
machine child output is bounded and captured separately from results.

`--log-level` filters advisory diagnostics at debug, info, warning, error or
critical severity. Fatal operation errors remain visible. `load --log-file`
opens a regular append file before backend work and writes structured lifecycle
and diagnostic records at the selected level. New files use owner-only
permissions. A later log-write error reports a secondary diagnostic without
replacing the operation result.

Human load displays event-driven progress on terminal stderr.
`--progress-format` accepts five presets or a custom counter template;
`TMUXP_PROGRESS_FORMAT` supplies the default. `--progress-lines` sets the recent
bootstrap-output panel: 3 rows by default, 0 hides it and -1 uses the initial
terminal height. `TMUXP_PROGRESS_LINES` supplies its default. The panel retains
at most 65,536 UTF-8 bytes and clips Unicode conservatively. It samples terminal
size once and does not track resizing. Bootstrap output is collected before
display, while preserving its original stdout or stderr destination.

`--no-progress`, `TMUXP_PROGRESS=0`, `TERM=dumb`, redirected stderr and machine
output disable the display. NDJSON receives discrete window/pane events.
Completion and interruption clear the panel. SIGINT and SIGTERM return status
130 and terminate captured children.

Python shell execution checks tmuxp 1.74.0 through `TMUX_WORKSPACE_PYTHON`,
defaulting to `python3`. Machine shell calls require `-c`; interactive backends
require a terminal. Shell completion can be generated from ArgumentParser. The
locally installed Linux executable still requires Swift runtime libraries.

The local source reference is Sources/TmuxWorkspaceCLI/README.md. Use the
native executable's `--help` for the options implemented in that checkout.

### Remaining gaps

- Window/pane environment, shell overrides, command timing/readiness, plugins
  and custom builders are not implemented in native loading.
- Incremental NDJSON child records, optional interactive Python backends,
  editor job control and broader descendant cleanup need completion or testing.
- Full capture/configuration coverage, generated manuals, Darwin validation
  and portable distribution remain open. Building without the YAML trait does
  not provide YAML commands.

## Historical builder audit

Audit date: 2026-09-09. [Native source snapshot](https://github.com/libtmux/libtmux-swift/tree/94b9e4cc436dda8e18e064179ae7d26e55bbbd73).
The following results describe that original library revision, before the local
CLI implementation. They are historical evidence, not its current capability
list or a support guarantee for a published artifact.

With optional YAML decoding enabled, the library parsed 23 upstream examples in
the original audit but could silently omit unsupported keys. The first-pane
explicit shell override was missing. YAML was absent from the default build, and
the source snapshot had no native CLI.

At that baseline, `TmuxWorkspace` supported JSON and optional YAML through the
`YAMLWorkspaces` trait. Its model covered names, directories, layouts and
commands with narrower shapes than tmuxp and could ignore unknown keys. Those
library decoder results do not describe current CLI execution preflight.

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
