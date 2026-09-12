---
title: "tmuxp compatibility and port status"
description: "Current local CLI capabilities, remaining gaps, and the historical builder audit."
port: java
product: workspace
sidebar:
  label: "tmuxp compatibility and port status"
  group: "Reference"
  order: 30
tableOfContents: true
---

**Local implementation, unpublished.** The Java `tmux-workspace` CLI
is available in the `workspace-cli` source worktree. Its command and
configuration coverage remains partial. See [installation](../../guides/installation/)
for local setup; installing a published library does not establish availability
of this CLI.

Compatibility targets useful tmuxp 1.74.0 commands and workspace workflows, with
native validation, execution and output conventions. Matching command names does
not promise identical runtime behavior or Python semantics.

## This port

Native services cover load, capture, discovery, search, conversion, both
importers, editor execution and diagnostics. Loading creates or reuses a
session; append authenticates the inherited tmux daemon and keeps the original
session across input files even if a script moves the invoking pane. Attached
load uses the controlling terminal and an authenticated invoking client/server.
Failure results identify retained effects rather than promising rollback.

The normalizer supports command shorthand and sequential enter/delay settings,
directories, environment, shell overrides, layouts, indexes, focus, options,
before-scripts and readiness policies. Blank panes and explicit launch commands
skip readiness checks. Unsupported configuration keys fail before tmux access.
YAML aliases and merges expand with depth/value bounds; strict JSON rejects YAML
syntax. Conversion preserves extension fields. Capture recovers topology,
directories, focus and configured options, but cannot recover command history,
bootstrap scripts or plugin intent. Search uses native Java regular expressions.

Every command accepts `--json` and `--ndjson`, with NDJSON taking precedence.
Load and child output stream as escaped events. Human output has semantic
colors; log levels and load log files keep diagnostics separate from results.
Interruptions have bounded final-output delivery and can leave an incomplete
stream. `load -2` selects 256-color mode; `-8` fails before workspace lookup.
The parser can generate command metadata and Bash completion.

Human load progress updates from events on terminal stderr. Five presets and
custom templates are supported; `--progress-lines` bounds the script panel,
with 3 rows by default, 0 hiding it and -1 using available initial terminal
height. Script streams keep their original destinations. Machine output,
redirected stderr, `TERM=dumb`, `--no-progress` and `TMUXP_PROGRESS=0` disable
the display. Completion and interruption clear the frame.

Python shell and workspace extension execution require an explicitly selected
`TMUX_WORKSPACE_PYTHON` interpreter with tmuxp 1.74.0. Plugin/custom-builder
loading checks that runtime before backend mutation and resolves builder imports
relative to the source document. Extension results identify observed topology;
they do not infer ownership of sessions returned by custom code. Append keeps
the authenticated borrowed session even if the invoking pane moves. Extension
append rejects any document containing `before_script`, including null or empty
values, because tmuxp can delete the borrowed session when that script fails.
Opaque extension execution does not emit native per-pane progress.

tmux 3.2a alters literal dollar signs in newly created session names; Python's
classic builder can fail its name check for those inputs. Ordinary names are
covered by the current/floor extension tests.

Interactive editors and Python shells use the controlling terminal while machine
results remain on stdout. Ordinary native load and read commands do not need
Python.

The local source reference is workspace-cli/README.md. Use the native
executable's `--help` for the options implemented in that checkout.

### Remaining gaps

- Interactive prompt behavior and broader Python extension coverage remain open.
- Progress samples terminal dimensions once and does not follow resizing.
  Unicode clipping is conservative.
- Complete configuration/importer/capture coverage and full terminal/platform
  acceptance remain unfinished. Explicit launch commands currently skip
  readiness even when the policy is `always`.
- Cancellation of caller-supplied streams that ignore interruption cannot reap
  their pending write; it may finish later when the caller drains the stream.
  Non-Linux descendant cleanup needs additional reparenting tests.

## Historical builder audit

Audit date: 2026-09-09. [Native source snapshot](https://github.com/libtmux/libtmux-java/tree/4f057d367a25dee818d70876fa283fc503a3a7eb).
The following results describe that original library revision, before the local
CLI implementation. They are historical evidence, not its current capability
list or a support guarantee for a published artifact.

The library parsed 3 upstream YAML examples in the original audit. Source and
integration tests passed for its supported builder surface, but starting a
named-layout workspace on a cold socket could fail. Full normalization and CLI
services were absent. The source snapshot had no native CLI.

At that baseline, the parser accepted session names/windows, window
names/layouts/panes and pane commands, and rejected unknown keys. The builder
used a staging session and attempted cleanup on failure. These observations
refer to the original library surface, not the current native CLI.

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
