---
title: "Workspace Manager for Swift (in development)"
description: "Build the local Swift tmux-workspace CLI; implementation coverage remains partial and unreleased."
port: swift
product: workspace
sidebar:
  label: Overview
  order: 0
tableOfContents: true
---

Native services discover, search, convert, import, edit, load, append and
capture workspaces. Common directories, command inheritance,
indexes, focus, session environment/options and before scripts are supported.
Python shell evaluation uses a checked tmuxp bridge.

`load -2` forces 256-color handling in native tmux clients. Legacy `-8` is
recognized but rejected before document lookup because supported tmux versions
do not implement 88-color mode. Without `-2`, tmux detects color support.

## Load a workspace from the terminal

Follow the [local installation walkthrough](./guides/installation/) from a
`workspace-cli` checkout of the
[Swift repository](https://github.com/libtmux/libtmux-swift). It builds
the native command and loads a small workspace on a private socket. After
building, inspect the command without starting tmux:

```console
$ .build/debug/tmux-workspace --help
```

Use detached load for the walkthrough. JSON and NDJSON output are available;
choose the mode explicitly when scripting. The command/configuration reference
below also documents tmuxp behavior and compatibility targets, so it is not a
claim that every referenced feature works in this local implementation.

## Current coverage

`--log-level` filters advisory diagnostics; fatal errors remain visible.
`load --log-file` appends structured lifecycle and diagnostic records to a regular
file. A write failure reports a secondary diagnostic and preserves the load result.

Human load displays progress on terminal stderr, with presets, custom counters
and a bounded recent-output panel. It uses the initial terminal size and
conservative Unicode clipping. Bootstrap output keeps its original stdout or
stderr destination, but is collected before display. Machine output disables
the panel and emits structured window/pane events. Interruption clears the
panel; SIGINT and SIGTERM return status 130 and stop captured children.

Human load with a foreground terminal attaches to the final workspace. Inside
tmux, choose switch, detached load, append or cancel. `-y` skips the mode prompt
and refuses an ambiguous client selection. Redirected and machine calls require
`-d` or `--append`. Detaching or interrupting the client preserves loaded sessions.

Plugins/custom builders, further pane/window execution
settings, fuller capture, generated manuals and portable distribution remain
unfinished. The complete tmuxp flag surface is not available.

For the released Python workflow, use [tmuxp](https://tmuxp.git-pull.com/)
and its [Python workspace guide](/py/latest/workspace/guides/). It is a separate
application and remains useful when a required native feature is incomplete.

## Start here

The `TmuxWorkspace` SwiftPM library product remains available for applications that
build sessions through code. [Internals](./internals/) documents that API:

- [Guides](./internals/guides/) show application setup and builder calls.
- [Topics](./internals/topics/) explain supported configuration and behavior.
- [Examples](./internals/examples/) exercise the library or source consumer.
- [API](./internals/api/) covers the builder and configuration interfaces.

## tmuxp command and configuration reference

Use the local CLI's help and the limits above when applying these compatibility
references to native execution.

- [Installation walkthrough](./guides/installation/) builds and runs the local native CLI.
- [Command reference](./cli/) lists tmuxp commands, flags and compatibility targets.
- [Configuration](./configuration/) covers fields, normalization and execution.
- [Example gallery](./examples/gallery/) includes upstream fixtures and prerequisites.
- [Compatibility status](./reference/compatibility/) records builder/reference gaps.
- [JSON, NDJSON, and color](./reference/output/) describes the shared output design.
