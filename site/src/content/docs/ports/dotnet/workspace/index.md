---
title: "Workspace Manager for .NET (in development)"
description: "Build the local .NET tmux-workspace CLI; implementation coverage remains partial and unreleased."
port: dotnet
product: workspace
sidebar:
  label: Overview
  order: 0
tableOfContents: true
---

Native services load/reuse/append and capture sessions, discover and search
documents, convert formats, import configurations and run editors. A checked
Python bridge provides Python-specific shell and workspace-extension behavior.

## Load a workspace from the terminal

Follow the [local installation walkthrough](./guides/installation/) from a
`workspace-cli` checkout of the
[.NET repository](https://github.com/libtmux/libtmux-dotnet). It builds
the native command and loads a small workspace on a private socket. After
building, inspect the command without starting tmux:

```console
$ artifacts/tools/tmux-workspace --help
```

Use detached load for the walkthrough. JSON and NDJSON output are available;
choose the mode explicitly when scripting. The command/configuration reference
below also documents tmuxp behavior and compatibility targets, so it is not a
claim that every referenced feature works in this local implementation.

## Current coverage

Native `--log-level` filters optional diagnostics. On Linux x64,
`load --log-file` appends structured logs; see the
[output reference](./reference/output/) for destination and failure handling.

On Linux x64, human load shows terminal progress on stderr, with presets,
literal token templates and bounded script output. See
[load](./cli/load/#progress-and-script-output) for counters, stream handling
and resize limits.

Native append retains the current pane's resolved session across all inputs,
even if a script moves the pane. Later commands reject a replacement daemon.
Append with Python plugins or custom builders is unavailable and fails before
building any input or starting Python; use `-d` for those extensions.

Human prompts and terminal attachment workflows, plugin and custom-builder
validation, contextual completion, and the full configuration and platform
corpus remain unfinished.

For the released Python workflow, use [tmuxp](https://tmuxp.git-pull.com/)
and its [Python workspace guide](/py/latest/workspace/guides/). It is a separate
application and remains useful when a required native feature is incomplete.

## Start here

The `LibTmux.Workspace` library package remains available for applications that
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
