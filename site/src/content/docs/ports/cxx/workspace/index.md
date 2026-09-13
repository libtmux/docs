---
title: "Workspace Manager for C++ (in development)"
description: "Build the local C++ tmux-workspace CLI; implementation coverage remains partial and unreleased."
port: cxx
product: workspace
sidebar:
  label: Overview
  order: 0
tableOfContents: true
---

Native services load and attach sessions, reuse exact names, append windows,
capture topology, discover and search documents, convert formats, import
configurations and run editors. Ordinary search uses C++ regular expressions.

## Load a workspace from the terminal

Follow the [local installation walkthrough](./guides/installation/) from a
`workspace-cli` checkout of the
[C++ repository](https://github.com/libtmux/libtmux-cxx). It builds
the native command and loads a small workspace on a private socket. After
building, inspect the command without starting tmux:

```console
$ build/cxx-dev/apps/workspace/tmux-workspace --help
```

Use detached load for the walkthrough. JSON and NDJSON output are available;
choose the mode explicitly when scripting. The command/configuration reference
below also documents tmuxp behavior and compatibility targets, so it is not a
claim that every referenced feature works in this local implementation.

## Current coverage

`before_script` runs a quoted command directly after session creation or append
selection, before settings and windows. All inputs are validated first. Script
failure removes a newly owned session and preserves a borrowed append session;
NDJSON streams script output while the child runs.

Human load requires a foreground terminal. It attaches outside tmux or switches
the unique terminal client viewing the invoking pane. The final input selects
the session, including reuse. Output is flushed before handoff; failures retain
loaded changes. See [loading and attachment](./cli/load/#native-c-loading).

Independent `active-pane` focus on the invoking physical window requires `-d`
or `--append`, including linked windows.

`load --log-file PATH` appends JSON diagnostics. Log levels filter optional
records without hiding required errors or changing machine results. See
[logging](./reference/output/#native-c-logging) for file and failure behavior.

Python shell/plugin/custom-builder execution, progress, completion,
full importer/configuration coverage and
portable packaging remain unfinished. Capture omits environment/options and
cannot recover original command arguments or history.

For the released Python workflow, use [tmuxp](https://tmuxp.git-pull.com/)
and its [Python workspace guide](/py/latest/workspace/guides/). It is a separate
application and remains useful when a required native feature is incomplete.

## Start here

The `workspace_builder` source consumer remains available for applications that
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
