---
title: "Workspace Manager for TypeScript (in development)"
description: "Build the local TypeScript tmux-workspace CLI; implementation coverage remains partial and unreleased."
port: ts
product: workspace
sidebar:
  label: Overview
  order: 0
tableOfContents: true
---

Native services load/reuse/append and capture sessions, discover and search
documents, convert formats, import configurations and run editors. Loading
includes terminal attach/switch, before scripts, progress and diagnostics.
Python shell evaluation and explicit plugin/custom-builder loads use an optional
tmuxp bridge. Ordinary native loads do not start Python. Native command metadata
and Bash, Zsh and fish completion come from the parser; completion starts no
Node, Bun or tmux process.

## Load a workspace from the terminal

Follow the [local installation walkthrough](./guides/installation/) from a
`workspace-cli` checkout of the
[TypeScript repository](https://github.com/libtmux/libtmux-ts). It builds
the native command and loads a small workspace on a private socket. After
building, inspect the command without starting tmux:

```console
$ node packages/workspace-cli/dist/main.js --help
```

Use detached load for the walkthrough. JSON and NDJSON output are available;
choose the mode explicitly when scripting. The command/configuration reference
below also documents tmuxp behavior and compatibility targets, so it is not a
claim that every referenced feature works in this local implementation.

## Current coverage

Interactive prompts and complete configuration/platform acceptance remain
unfinished. Python extensions require tmuxp 1.74.0 and report observed effects
without claiming ownership or rollback. See [hooks and builders](./configuration/hooks/)
for append restrictions. Capture reports live state rather than recovering the
original workspace commands or extension intent.

For the released Python workflow, use [tmuxp](https://tmuxp.git-pull.com/)
and its [Python workspace guide](/py/latest/workspace/guides/). It is a separate
application and remains useful when a required native feature is incomplete.

## Start here

The `@libtmux/workspace` library package remains available for applications that
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
