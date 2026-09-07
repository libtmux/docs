---
title: "Workspace Manager for Python"
description: "Create, load, and export tmux workspaces with tmuxp."
port: py
product: workspace
sidebar:
  label: Overview
  order: 0
tableOfContents: true
---

[tmuxp](https://tmuxp.git-pull.com/) is Python's workspace manager built on
libtmux. A YAML or JSON file describes a session, its windows and panes, and
the commands to run. `tmuxp load` builds that workspace and can attach you to
it or leave it detached.

The application also finds saved workspaces, exports a running session,
converts configuration formats, and supports Python plugins and custom
workspace builders.

## Start here

- [Guides](./guides/) install tmuxp and load a workspace on a dedicated socket.
- [Topics](./topics/) explain expansion, builders, existing sessions, and
  exports.
- [Examples](./examples/) show a source workspace and a Python builder example.
- [API](./api/) maps loading, building, freezing, and extension interfaces.

## Package and documentation

Install `tmuxp` separately from the core `libtmux` package. Let its dependency
resolver choose a compatible libtmux version. The MCP server is another
application with its own requirements, so use separate tool environments when
their dependency ranges differ.

These internal pages connect the Python implementation to the port documentation
system. The [tmuxp documentation](https://tmuxp.git-pull.com/) remains the
complete upstream guide to its CLI, workspace format, and extension APIs.

[Upstream quickstart source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/docs/quickstart.md)
