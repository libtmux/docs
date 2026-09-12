---
title: "Export and reload a session"
description: "Capture, inspect, and replay a workspace without assuming lossless recovery."
port: swift
product: workspace
sidebar:
  label: "Export and reload a session"
  group: "Guides"
  order: 26
tableOfContents: true
---

**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.

Use the session created by the [installation walkthrough](../installation/).
Capture it to a new YAML destination:

```console
$ tmuxp freeze \
    -L workspace-guide \
    --workspace-format yaml \
    --save-to captured-workspace.yaml \
    --yes \
    workspace-guide
```

Review the output file. Capture cannot reconstruct original scripts, shell
history, plugin decisions, comments, or every application's state. Compare
window and pane topology, directories, layouts, environment, and options
explicitly.

Replay under a new name on the same dedicated server:

```console
$ tmuxp load \
    -L workspace-guide \
    -d \
    -s workspace-replay \
    captured-workspace.yaml
```

Inspect the replay:

```console
$ tmux -L workspace-guide list-panes -t '=workspace-replay'
```

Remove the replay when finished:

```console
$ tmux -L workspace-guide kill-session -t '=workspace-replay'
```

The [freeze reference](../../cli/freeze/) explains prompts and overwrite
behavior. [convert](../../cli/convert/) changes document representation without
validating native execution support. The [native compatibility
page](../../reference/compatibility/) records which ports lack capture or lose
fields.

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
