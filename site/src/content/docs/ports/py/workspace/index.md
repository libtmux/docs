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
- [Topics](./topics/) explain configuration, existing sessions, and exports.
- [Examples](./examples/) load YAML and JSON through the CLI.
- [Internals](./internals/) describe the builder pipeline and Python APIs for
  contributors and extension authors.

## Package and documentation

Install `tmuxp` separately from the core `libtmux` package. Let its dependency
resolver choose a compatible libtmux version. The MCP server is another
application with its own requirements, so use separate tool environments when
their dependency ranges differ.

The [tmuxp documentation](https://tmuxp.git-pull.com/) provides the complete
upstream CLI reference, workspace format, and extension documentation.

[Upstream quickstart source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/docs/quickstart.md)

## tmuxp command and configuration reference

The Python command pages document the current tmuxp reference and label proposed native extensions.

- [Installation walkthrough](./guides/installation/) uses the available Python tool.
- [Command reference](./cli/) lists commands, flags, and observed behavior.
- [Configuration](./configuration/) covers fields, normalization, and execution.
- [Example gallery](./examples/gallery/) includes upstream fixtures and prerequisites.
- [Compatibility status](./reference/compatibility/) records native builder gaps.
- [JSON, NDJSON, and color](./reference/output/) defines the proposed native output contract.
