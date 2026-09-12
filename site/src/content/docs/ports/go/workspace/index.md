---
title: "Workspace Manager for Go (in development)"
description: "Build the local Go tmux-workspace CLI; implementation coverage remains partial and unreleased."
port: go
product: workspace
sidebar:
  label: Overview
  order: 0
tableOfContents: true
---

Native services provide load/reuse/append, capture, discovery, conversion,
imports, editor execution and search. Loading supports common commands,
directories, environment, options, before scripts and terminal progress.
Native script arguments validate for all inputs before session mutation.
Append authenticates the inherited server and retains one target session across
all inputs. Plugin and custom-builder append use that session through the
checked Python bridge when the document has no `before_script` key.

## Load a workspace from the terminal

Follow the [local installation walkthrough](./guides/installation/) from a
`workspace-cli` checkout of the
[Go repository](https://github.com/libtmux/libtmux-go). It builds
the native command and loads a small workspace on a private socket. After
building, inspect the command without starting tmux:

```console
$ ./tmux-workspace --help
```

Use detached load for the walkthrough. JSON and NDJSON output are available;
choose the mode explicitly when scripting. The command/configuration reference
below also documents tmuxp behavior and compatibility targets, so it is not a
claim that every referenced feature works in this local implementation.

## Current coverage

Append through the Python workspace bridge with a document `before_script`
key is unavailable and fails during preflight, including empty or null values.
This prevents Python's script-failure cleanup from deleting the borrowed
session. Native scripted append remains supported.

`load -s` changes only the final input's session name; earlier inputs keep
their configured names. Legacy `-8` and `--88-colors` fail before workspace
lookup or runtime checks. Use `-2` to request 256-color mode.

Native Go logging supports `--log-level` and structured `--log-file` output
on Unix. Diagnostic filtering preserves mandatory command errors and machine
results. See the [logging contract](./reference/output/#native-go-logging).

Some cleanup and interruption paths, complete configuration coverage, and
portable packaging still need work. Capture cannot
reconstruct original command arguments, history or workspace extensions.

For the released Python workflow, use [tmuxp](https://tmuxp.git-pull.com/)
and its [Python workspace guide](/py/latest/workspace/guides/). It is a separate
application and remains useful when a required native feature is incomplete.

## Start here

The `workspace` library module remains available for applications that
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
