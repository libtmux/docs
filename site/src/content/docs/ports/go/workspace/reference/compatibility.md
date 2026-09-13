---
title: "tmuxp compatibility and port status"
description: "Current local CLI capabilities, remaining gaps, and the historical builder audit."
port: go
product: workspace
sidebar:
  label: "tmuxp compatibility and port status"
  group: "Reference"
  order: 30
tableOfContents: true
---

**Local implementation, unpublished.** The Go `tmux-workspace` CLI
is available in the `workspace-cli` source worktree. Its command and
configuration coverage remains partial. See [installation](../../guides/installation/)
for local setup; installing a published library does not establish availability
of this CLI.

Compatibility targets useful tmuxp 1.74.0 commands and workspace workflows, with
native validation, execution and output conventions. Matching command names does
not promise identical runtime behavior or Python semantics.

## This port

Native services cover load, capture, discovery, search, conversion, both
importers, editor execution and diagnostics. Load creates or reuses a session,
or appends to the current pane's session. Human foreground loading offers
switch/detach/append choices inside tmux and requires terminal stdin. Machine
load requires `-d` or `--append` and does not prompt. Native before-script
arguments validate for all inputs before session mutation. A failed native
script removes an owned newly created session and preserves a borrowed append
session. With several inputs, `load -s` changes only the final workspace's
session name; earlier inputs retain their configured names in native and
Python-bridge execution.

Before foreground loading, the CLI opens the controlling terminal outside
tmux, or verifies the inherited server, pane and input terminal inside tmux.
Switching requires one identifiable terminal client viewing that pane. Multiple
matching clients and independent `active-pane` clients on the same physical
window require detached or append mode. The selected client's identity and
attachment are checked again before switching.

Progress stops and both output streams are flushed before handoff. A failed
prompt flush stops before input is read. Handoff failures retain completed
workspace results for diagnostics. These checks do not make the later tmux
client-name operation atomic with client replacement.

Append checks the inherited server PID and selected socket before checking
Python. Socket paths may contain commas. It retains one session across all
inputs even if a script moves the invoking pane; linked panes use tmux's
canonical session. Native build entry rechecks that retained session before
running a before script, and subsequent commands retain the core's daemon
replacement checks.

Legacy `-8` and `--88-colors` fail before workspace lookup, runtime checks or
backend mutation. `-2` requests 256-color mode.

The normalizer supports pane and command shorthand, inherited commands,
sequential enter/delay settings, history suppression, directories, launch-time
environment, shell overrides, layouts, indexes, focus, options, before-scripts
and readiness policies. Conversion preserves extension fields. Explicit saves
use atomic publication and require `--force` for replacement. Capture warns that
original arguments, history, scripts and plugins cannot be recovered.

Every command accepts `--json` and `--ndjson`; NDJSON takes precedence. Load
streams sequenced events and a terminal result. Human load has semantic colors
and terminal progress with presets, custom tokens and bounded script lines.
Machine output disables terminal rendering. Documentation, command metadata,
manuals and shell completion can be generated from the command graph.

`ls --tree` groups workspaces by directory in discovery order. `--full` includes
their YAML configurations. Human names and paths escape terminal controls;
machine records preserve the underlying values and ignore tree presentation.

Native Go logging supports `--log-level` and structured `--log-file` output
on Unix. Optional diagnostics follow the selected level; mandatory command
errors and machine results remain visible. A later log write or close failure
preserves the workspace outcome and attempts at most one optional warning.
See the [logging contract](../output/#native-go-logging).

Search uses native Go regular expressions with ASCII word boundaries and JSON
text for structured commands. `--regex-engine python` explicitly selects a
checked Python runtime for Python regex syntax and representations. Python
shell, plugin and custom-builder execution checks tmuxp 1.74.0 through
`TMUX_WORKSPACE_PYTHON`; ordinary native commands do not require that runtime.
Plugin and custom-builder append use the retained session, including when the
caller also supplies `-d`. The adapter checks its daemon and session before
importing extensions and after constructing the builder. A missing or replaced
target fails without creating a replacement session; errors retain the original
session ID. These checks do not make later builder execution atomic against
external server replacement or arbitrary plugin code. Documents without a
`before_script` key can add windows through that bridge.

The local source reference is workspace/CLI.md. Use the native executable's
`--help` for the options implemented in that checkout.

### Remaining gaps

- Selecting `plugins`, `workspace_builder` or `workspace_builder_paths` with
  `--append` and a document `before_script` key is unavailable and fails during
  preflight, including an empty or null script value.
  The checked Python builder can delete a borrowed session on script failure;
  the CLI blocks that combination before runtime checks or session mutation.
  Native scripted append and plugin append without a document script remain
  supported.
- Script lifecycle failures and effects before an input returns from building
  need additional coverage.
- Complete human catalog rendering remains unfinished.
- SIGTERM, descendant cleanup across platforms, optional Python terminals,
  complete configuration/importer coverage and installed completion execution
  remain acceptance gaps.

## Historical builder audit

Audit date: 2026-09-09. [Native source snapshot](https://github.com/libtmux/libtmux-go/tree/bb48780c49652d6b7a17884f19a93c269f04a688).
The following results describe that original library revision, before the local
CLI implementation. They are historical evidence, not its current capability
list or a support guarantee for a published artifact.

The library parsed 20 upstream YAML examples and built 18 in the original audit.
First-pane environment was applied too late; pane environment and split shell
inheritance were incomplete. Explicit zero delay could inherit a nonzero value.
YAML/JSON serialization needed a document-preserving boundary. The source
snapshot had no native CLI.

At that baseline, the workspace package rejected unknown fields, did not perform
tmuxp variable expansion or run Python plugins, and could leave partial state
after a builder error. These historical library limits do not describe the
current CLI normalizer, document conversion or explicit Python bridge.

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
