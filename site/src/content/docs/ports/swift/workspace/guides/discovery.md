---
title: "Find saved workspaces"
description: "Resolve project files, explicit paths, and global workspace names."
port: swift
product: workspace
sidebar:
  label: "Find saved workspaces"
  group: "Guides"
  order: 24
tableOfContents: true
---

**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.

Use an explicit YAML or JSON file path when you need an unambiguous input. A
directory resolves its project configuration, and a saved name resolves through
the tmuxp configuration roots.

## Global directories

An existing `TMUXP_CONFIGDIR` takes precedence, followed by the XDG
configuration directory and then the legacy [`~/.tmuxp`](./) directory. A nonexistent
explicit directory does not automatically win discovery. See
[environment](../../configuration/environment/) for the relevant variables.

## Project files

Project discovery walks from the current directory toward its ancestors,
stopping at home or the filesystem root. It selects at most one candidate per
directory, preferring `.tmuxp.yaml`, then [`.tmuxp.yml`](./), then [`.tmuxp.json`](./).
Nearer directories come first. It does not recursively enumerate child projects.

Load the current project's configuration:

```console
$ tmuxp load .
```

The normal command can attach or prompt. Use `-d` when you want detached
execution and select `-L` or `-S` for an isolated server. [ls](../../cli/ls/),
[search](../../cli/search/), and [edit](../../cli/edit/) use the same discovery
concepts with their own result and error behavior.

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
