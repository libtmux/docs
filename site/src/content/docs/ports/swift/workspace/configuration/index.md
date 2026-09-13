---
title: "Workspace configuration"
description: "Tmuxp workspace configuration and current Swift builder compatibility."
port: swift
product: workspace
sidebar:
  group: Configuration
  label: "Overview"
  order: 30
tableOfContents: true
---

**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../reference/compatibility/) describes this port's implemented coverage.

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

## Current Swift builder

`TmuxWorkspace` supports JSON decoding and optional YAML decoding through the
`YAMLWorkspaces` trait. Unknown keys can be ignored. The model covers names,
directories, layouts, and commands, with narrower shapes than tmuxp.

See the [native builder behavior](../internals/topics/) and [configuration
source](https://github.com/libtmux/libtmux-swift/blob/94b9e4cc436dda8e18e064179ae7d26e55bbbd73/Sources/TmuxWorkspace/Workspace.swift)
before using these fields through application code.

## Reference source

[loader.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/loader.py); [validation.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/validation.py); [classic.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/classic.py).
