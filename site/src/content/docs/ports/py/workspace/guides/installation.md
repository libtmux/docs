---
title: "Install and load a workspace"
description: "Run the available Python workspace tool on a dedicated tmux socket."
port: py
product: workspace
sidebar:
  label: "Install and load a workspace"
  group: "Guides"
  order: 23
tableOfContents: true
---

This page documents the available Python tmuxp reference. Proposed native
extensions are labeled separately.

The runnable terminal loader is the separate Python application tmuxp. Its
documented prerequisites are Python 3.10 or newer and tmux 3.2 or newer. Install
it in an isolated tool environment with uv:

```console
$ uv tool install tmuxp
```

The tool environment owns tmuxp's Python dependencies. Installing a native
libtmux workspace library does not install a tmuxp-compatible CLI.

## Create the input

Save this file as [`workspace.yaml`](./#create-the-input) in a writable directory:

```yaml
session_name: workspace-guide
windows:
  - window_name: editor
    layout: even-horizontal
    panes:
      - echo ready
      - echo second
```

Load the session detached. Reserve the socket name for this walkthrough:

```console
$ tmuxp load \
    -L workspace-guide \
    -d \
    workspace.yaml
```

Inspect the two panes:

```console
$ tmux -L workspace-guide list-panes -t '=workspace-guide:editor'
```

Attach when ready:

```console
$ tmux -L workspace-guide attach-session -t '=workspace-guide'
```

Detach with your configured tmux detach binding. Before cleanup, optionally try
[export and reload](../export-session/). Remove only this walkthrough's session
when finished:

```console
$ tmux -L workspace-guide kill-session -t '=workspace-guide'
```

## Continue

[Discovery](../discovery/) explains project files and saved names. [Configuration](../../configuration/) describes accepted fields, and [load](../../cli/load/) documents all flags. The [compatibility reference](../../reference/compatibility/) records native builder limitations.

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
