---
title: "Python workspace examples"
description: "Load tmux workspaces from YAML or JSON with the tmuxp CLI."
port: py
product: workspace
sidebar:
  label: Examples
  order: 3
tableOfContents: true
---

Save a workspace file and pass it to [tmuxp](https://tmuxp.git-pull.com/).
These examples require tmuxp and tmux; the [guide](../guides/) covers
installation. No Python program is needed.

## Load YAML

Save this upstream two-pane example as `workspace.yaml`:

```yaml
session_name: 2-pane-vertical
windows:
  - window_name: my test window
    panes:
      - echo hello
      - echo hello
```

Load the workspace and attach to it:

```console
$ tmuxp load workspace.yaml
```

Inside tmux, the loader offers to switch clients or append windows. Detach
with your tmux prefix followed by `d` to leave the session running.

## Load JSON without attaching

The same configuration fields also work in JSON. Save this separate workspace
as `workspace.json`:

```json
{
  "session_name": "json-workspace",
  "windows": [
    {
      "window_name": "editor",
      "panes": ["echo ready", "echo ready"]
    }
  ]
}
```

Load it detached on a dedicated socket:

```console
$ tmuxp load \
    -L workspace-json-example \
    -d \
    workspace.json
```

Inspect its panes:

```console
$ tmux -L workspace-json-example list-panes -t '=json-workspace:editor'
```

Remove the example session when finished:

```console
$ tmux -L workspace-json-example kill-session -t '=json-workspace'
```

## More configurations

The upstream [configuration examples](https://tmuxp.git-pull.com/configuration/examples/)
cover layouts, focus, directories, environment values, and command shorthand.
The [load reference](https://tmuxp.git-pull.com/cli/load/) documents file
selection, attachment, and existing sessions.

For contributors studying how a file becomes a session, see the
[internal builder example](../internals/examples/).

[Two-pane YAML source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/2-pane-vertical.yaml)
