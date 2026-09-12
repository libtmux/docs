---
title: "Workspace Manager for Java (in development)"
description: "Build the local Java tmux-workspace CLI; implementation coverage remains partial and unreleased."
port: java
product: workspace
sidebar:
  label: Overview
  order: 0
tableOfContents: true
---

Native services load and capture sessions, discover and search documents,
convert formats, import configurations and run editors. Common commands,
layout, environment, before scripts and diagnostics are implemented. Python
shell evaluation and plugin/custom-builder loading use a checked tmuxp bridge.
Human load progress supports
presets, custom templates and a bounded script-output panel. Append keeps its
original target session across input files.

## Load a workspace from the terminal

Follow the [local installation walkthrough](./guides/installation/) from a
`workspace-cli` checkout of the
[Java repository](https://github.com/libtmux/libtmux-java). It builds
the native command and loads a small workspace on a private socket. After
building, inspect the command without starting tmux:

```console
$ workspace-cli/build/install/tmux-workspace/bin/tmux-workspace --help
```

Use detached load for the walkthrough. JSON and NDJSON output are available;
choose the mode explicitly when scripting. The command/configuration reference
below also documents tmuxp behavior and compatibility targets, so it is not a
claim that every referenced feature works in this local implementation.

## Current coverage

Python plugins and custom builders execute through the checked tmuxp bridge.
Extension append rejects documents containing `before_script` to preserve the
borrowed session. Complete configuration/capture coverage and full
terminal/platform acceptance remain unfinished. Progress uses the initial
terminal dimensions; it does not track resizing, and Unicode clipping is
conservative.

For the released Python workflow, use [tmuxp](https://tmuxp.git-pull.com/)
and its [Python workspace guide](/py/latest/workspace/guides/). It is a separate
application and remains useful when a required native feature is incomplete.

## Start here

The `libtmux-workspace` library module remains available for applications that
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
