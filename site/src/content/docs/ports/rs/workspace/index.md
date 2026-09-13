---
title: "Workspace Manager for Rust (in development)"
description: "Build the local Rust tmux-workspace CLI; implementation coverage remains partial and unreleased."
port: rs
product: workspace
sidebar:
  label: Overview
  order: 0
tableOfContents: true
---

Native services load and capture sessions, discover and search documents,
convert formats, import tmuxinator/teamocil files, and run editors. Python
shells and workspace extensions use an explicit version-checked bridge.
Append validates the current daemon and retains the borrowed session across
inputs.

## Load a workspace from the terminal

Follow the [local installation walkthrough](./guides/installation/) from a
`workspace-cli` checkout of the
[Rust repository](https://github.com/libtmux/libtmux-rs). It builds
the native command and loads a small workspace on a private socket. After
building, inspect the command without starting tmux:

```console
$ target/release/tmux-workspace --help
```

Use detached load for the walkthrough. JSON and NDJSON output are available;
choose the mode explicitly when scripting. The command/configuration reference
below also documents tmuxp behavior and compatibility targets, so it is not a
claim that every referenced feature works in this local implementation.

## Current coverage

Native load supports [filtered file logging](./reference/output/#native-rust-logging).

Progress controls, complete terminal attachment and interruption behavior,
discovery/search edge cases, and the full configuration and platform corpus
remain unfinished. Some accepted flags are compatibility targets rather
than implemented behavior.

For the released Python workflow, use [tmuxp](https://tmuxp.git-pull.com/)
and its [Python workspace guide](/py/latest/workspace/guides/). It is a separate
application and remains useful when a required native feature is incomplete.

## Start here

The `tmux-workspace` library crate remains available for applications that
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
