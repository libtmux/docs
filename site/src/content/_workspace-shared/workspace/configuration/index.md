---
description: Tmuxp workspace configuration, field meanings, defaults, and execution behavior.
product: workspace
sidebar:
  group: Configuration
  label: Overview
  order: 30
tableOfContents: true
title: Workspace configuration
ports:
  ts:
    description: Tmuxp workspace configuration and current TypeScript builder compatibility.
  rs:
    description: Tmuxp workspace configuration and current Rust builder compatibility.
  go:
    description: Tmuxp workspace configuration and current Go builder compatibility.
  java:
    description: Tmuxp workspace configuration and current Java builder compatibility.
  dotnet:
    description: Tmuxp workspace configuration and current .NET builder compatibility.
  cxx:
    description: Tmuxp workspace configuration and current C++ builder compatibility.
  swift:
    description: Tmuxp workspace configuration and current Swift builder compatibility.
---

<!-- port:py -->This page documents Python tmuxp configuration at the pinned reference revision.
Use tmuxp for the command examples below.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../reference/compatibility/) describes this port's implemented coverage.
<!-- /port -->
A workspace file describes one tmux session, its windows and panes, and the
commands sent to them. YAML and JSON carry the same field names. Save this
complete example as [`workspace.yaml`](../guides/installation/#create-the-input):

```yaml
session_name: workspace-example
start_directory: ./
windows:
  - window_name: editor
    layout: even-horizontal
    panes:
      - echo ready
      - blank
```

The equivalent JSON is:

```json
{
  "session_name": "workspace-example",
  "start_directory": "./",
  "windows": [
    {
      "window_name": "editor",
      "layout": "even-horizontal",
      "panes": ["echo ready", "blank"]
    }
  ]
}
```

With Python tmuxp installed, load this file detached on a socket reserved for
the example:

```console
$ tmuxp load \
    -L configuration-example \
    -d \
    workspace.yaml
```

Inspect the resulting panes:

```console
$ tmux -L configuration-example list-panes -t '=workspace-example'
```

Remove the example session when finished:

```console
$ tmux -L configuration-example kill-session -t '=workspace-example'
```

## How configuration becomes a session

The tmuxp loader reads a document, expands command shorthand and shell
variables, and applies inherited defaults before selecting a workspace builder.
The classic builder then creates tmux objects and sends commands. Completion
means construction and command delivery finished; it does not establish that a
server launched in a pane is ready.

`"session_name"` and `"windows"` are needed by normal loading. A window can omit its
name and let tmux choose one; an omitted `"panes"` list defaults to one blank
pane. Supplying explicit names and pane lists makes a portable example clearer.
An empty pane list is not the same input as an omitted list.

The internal `validate_schema` helper requires each window_name, but the current
CLI/classic builder path does not call it. It is not a complete JSON Schema or
an exact description of what load accepts. A YAML parser accepting a key also
does not mean a builder implements it.

## Configuration reference

- [Session](./session/) covers identity, options, environment, and root keys.
- [Windows](./windows/) covers names, indexes, option timing, and focus.
- [Panes](./panes/) covers shorthand, blank forms, shell, and overrides.
- [Commands](./commands/) covers before commands, Enter, delays, and history.
- [Environment](./environment/) separates process settings from pane values.
- [Directories](./directories/) explains file discovery and path resolution.
- [Layouts](./layouts/) explains pane arrangement and terminal size.
- [Hooks and builders](./hooks/) covers scripts and Python extensions.

Use the [configuration gallery](../examples/gallery/) for more complete files.
Configuration conversion should preserve the source mapping, including extension
keys; loading that mapping requires separate support for every execution
feature.

<!-- port:ts -->## Current TypeScript builder
<!-- /port --><!-- port:rs -->## Current Rust builder
<!-- /port --><!-- port:go -->## Current Go builder
<!-- /port --><!-- port:java -->## Native Java CLI
<!-- /port --><!-- port:dotnet -->## Current .NET builder
<!-- /port --><!-- port:cxx -->## Current C++ builder
<!-- /port --><!-- port:swift -->## Current Swift builder
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->
<!-- /port --><!-- port:ts -->`@libtmux/workspace` validates a strict subset. Its apply operation reconciles a
session using ownership and command policies, which differs from tmuxp load. Its
YAML helper requires Bun; Node callers need a separate YAML decoder.
<!-- /port --><!-- port:rs -->`tmux-workspace` parses a configuration subset and records unknown keys in
`unsupported_keys`. It does not execute those keys. Building creates a new
session; a failure after creation can leave partial state.
<!-- /port --><!-- port:go -->The Go workspace package rejects unknown fields. It supports a configuration
subset, but does not perform tmuxp variable expansion or run Python plugins. Its
builder can leave partial state after an error.
<!-- /port --><!-- port:java -->The local `tmux-workspace` CLI validates its native configuration before scripts
run or tmux state changes. It supports the session, window, pane and command
fields described in the sections below. Unsupported native keys fail explicitly;
Python plugin/custom-builder inputs use the separately selected extension path.
Generic conversion preserves document fields without proving native execution.
<!-- /port --><!-- port:dotnet -->`LibTmux.Workspace` rejects unknown or duplicate keys and unsupported value
shapes. Its parser and builder cover a subset of this reference. Build errors
can expose a partial result; there is no automatic rollback.
<!-- /port --><!-- port:cxx -->The C++ workspace consumer is a source-tree library target. Its YAML parser
rejects fields outside its supported subset. Building can leave earlier tmux
changes in place after failure.
<!-- /port --><!-- port:swift -->`TmuxWorkspace` supports JSON decoding and optional YAML decoding through the
`YAMLWorkspaces` trait. Unknown keys can be ignored. The model covers names,
directories, layouts, and commands, with narrower shapes than tmuxp.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->
<!-- /port --><!-- port:ts,rs,go,dotnet,cxx,swift -->See the [native builder behavior](../internals/topics/) and [configuration
<!-- /port --><!-- port:ts -->source](https://github.com/libtmux/libtmux-ts/blob/f85b8de551353f746d50eaf36bf0112f4fe5a528/packages/workspace/src/config.ts)
<!-- /port --><!-- port:rs -->source](https://github.com/libtmux/libtmux-rs/blob/4a9afac1d82d9a6a9af16099e7b846e69f0e6388/crates/tmux-workspace/src/config.rs)
<!-- /port --><!-- port:go -->source](https://github.com/libtmux/libtmux-go/blob/bb48780c49652d6b7a17884f19a93c269f04a688/workspace/workspace.go)
<!-- /port --><!-- port:dotnet -->source](https://github.com/libtmux/libtmux-dotnet/blob/b71b9654f41785c93717e454cbf176672b3d634a/src/LibTmux.Workspace/WorkspaceYamlParser.cs)
<!-- /port --><!-- port:cxx -->source](https://github.com/libtmux/libtmux-cxx/blob/c7f1146d2ebd7a8323d9f9814517dc3cdf86b4ee/examples/workspace/src/tmuxp.cpp)
<!-- /port --><!-- port:swift -->source](https://github.com/libtmux/libtmux-swift/blob/94b9e4cc436dda8e18e064179ae7d26e55bbbd73/Sources/TmuxWorkspace/Workspace.swift)
<!-- /port --><!-- port:ts,rs,go,dotnet,cxx,swift -->before using these fields through application code.
<!-- /port --><!-- port:java -->See the [CLI configuration parser](https://github.com/libtmux/libtmux-java/blob/2d7e8028986b99c8e9496dc40b5d1e90fb2368c9/workspace-cli/src/main/java/io/github/libtmux/workspace/cli/WorkspacePlan.java).
Application code using the lower-level workspace library has a separate
[builder API](../internals/topics/). Its schema is not the CLI configuration
contract.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->
<!-- /port -->## Reference source

[loader.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/loader.py); [validation.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/validation.py); [classic.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/classic.py).
