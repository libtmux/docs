---
description: Define the session, windows, panes and commands loaded by the workspace CLI.
product: workspace
sidebar:
  group: Configuration
  label: Workspace configuration
  order: 30
tableOfContents: true
title: Workspace configuration
---

<!-- port:py -->
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

## Reference source

[loader.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/loader.py); [validation.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/validation.py); [classic.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/classic.py).
<!-- /port -->

<!-- port:ts,rs,go,java,dotnet,cxx,swift -->
A workspace document describes one tmux session. Save this as `configuration.yaml`:

```yaml title="configuration.yaml"
session_name: configuration-example
windows:
  - window_name: editor
    layout: even-horizontal
    panes:
      - printf ready
      - null
```

Load it on the private socket from the
[installation walkthrough](../guides/installation/):

```console
$ tmux-workspace load \
    -S "$WORKSPACE_TMP/tmux.sock" \
    -d \
    --json \
    configuration.yaml
```

The CLI parses the document and validates its execution fields before creating
windows and sending commands. YAML and JSON use the same field names. A successful
load means construction and command delivery completed; pane applications can
still be starting or failing independently.

## Choose the fields for your task

- [Session](./session/) sets the name, shared options and environment.
- [Windows](./windows/) sets indexes, layouts and option timing.
- [Panes](./panes/) defines commands, launch shells and focus.
- [Commands](./commands/) controls ordering, Enter and delays.
- [Environment](./environment/) separates loader settings from pane variables.
- [Directories](./directories/) explains discovery and working directories.
- [Layouts](./layouts/) arranges the panes.
- [Hooks](./hooks/) runs checked bootstrap programs and optional extensions.

## CLI and application code

These pages describe the `tmux-workspace` executable. Application code uses the
separate [workspace library](../internals/), whose accepted fields and build
semantics have their own contract. A successful generic [conversion](../cli/convert/)
preserves document values; it does not validate that a loader can execute them.

<!-- port:ts -->
[CLI source](https://github.com/libtmux/libtmux-ts/blob/f36d692552bb9a373b45338bb5fece854e57cc3d/packages/workspace-cli/README.md).
<!-- /port -->
<!-- port:rs -->
[CLI source](https://github.com/libtmux/libtmux-rs/blob/e9be0b6f6d22cd2eb79b0ec08964f82e717e5fe4/crates/tmux-workspace/docs/cli.md).
<!-- /port -->
<!-- port:go -->
[CLI source](https://github.com/libtmux/libtmux-go/blob/bb06e26e116e941813ca40bf45e7e3a47d38f52a/workspace/CLI.md).
<!-- /port -->
<!-- port:java -->
[CLI source](https://github.com/libtmux/libtmux-java/blob/3e5b20d22af3890ae5f7f52842e4b05d170a983f/libtmux-workspace-cli/README.md).
<!-- /port -->
<!-- port:dotnet -->
[CLI source](https://github.com/libtmux/libtmux-dotnet/blob/f77fe776ba67a04abb20ddbbc26cf4a000d63b74/src/LibTmux.Workspace.Cli/README.md).
<!-- /port -->
<!-- port:cxx -->
[CLI source](https://github.com/libtmux/libtmux-cxx/blob/9c8c6a264114277df84c9f6819855093adae5c6e/apps/workspace/README.md).
<!-- /port -->
<!-- port:swift -->
[CLI source](https://github.com/libtmux/libtmux-swift/blob/53c67947879f4976ddf2c43f3c8df7c7671c5b19/Sources/TmuxWorkspaceCLI/README.md).
<!-- /port -->
<!-- /port -->
