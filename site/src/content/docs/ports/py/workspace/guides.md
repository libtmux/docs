---
title: "Load a Python workspace"
description: "Install tmuxp, load YAML on a dedicated socket, and inspect the session."
port: py
product: workspace
sidebar:
  label: Guides
  order: 2
tableOfContents: true
---

Install tmuxp as a Python tool, with Python 3.10 or newer and tmux 3.2 or newer
available on the host:

```console
$ uv tool install tmuxp
```

The tool environment owns tmuxp's dependencies. Keep a separately installed
MCP application in its own environment if its libtmux requirement differs.

## Describe the workspace

Save this upstream example as `workspace.yaml`:

```yaml
session_name: 2-pane-vertical
windows:
  - window_name: my test window
    panes:
      - echo hello
      - echo hello
```

Load it detached on a dedicated socket, without changing your attached
session:

```console
$ tmuxp load \
    -L workspace-guide \
    -d \
    workspace.yaml
```

The `-L` value selects the tmux server and `-d` prevents attachment. Reserve
that socket name for this example. Omit `-d` when you want tmuxp to attach or
offer its normal client-switching flow.

Inspect the created session:

```console
$ tmux -L workspace-guide list-sessions
```

When finished, remove only the example session:

```console
$ tmux -L workspace-guide kill-session -t '=2-pane-vertical'
```

## Saved workspaces and export

`tmuxp load` accepts file paths and names resolved through its configuration
search. Use an explicit path while learning the format so the loaded file is
unambiguous.

Use `tmuxp freeze` for a session you want to capture as a starting
configuration.
It offers YAML or JSON output. Inspect the generated command lists and paths
before using the export later.

The upstream [load reference](https://tmuxp.git-pull.com/cli/load/) covers
append, session-name, socket, and attachment options. The
[freeze reference](https://tmuxp.git-pull.com/cli/freeze/) covers output choices.

[Workspace source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/2-pane-vertical.yaml); [CLI option definitions](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/load.py).
