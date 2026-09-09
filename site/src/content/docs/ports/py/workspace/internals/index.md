---
title: "Python workspace internals"
description: "How tmuxp loads configuration and builds sessions through libtmux."
port: py
product: workspace
sidebar:
  label: Overview
  group: Internals
  order: 0
tableOfContents: true
---

These pages describe tmuxp's internal implementation for contributors and
extension authors. The Python interfaces have no stability guarantee and
may change between releases. Use [tmuxp load](../guides/) to launch a
workspace from the terminal.

## Builder pipeline

The CLI reads YAML or JSON, expands shorthand and variables, applies inherited
defaults, and passes the result to a workspace builder. The builder uses
libtmux to create the session, windows, and panes. The CLI then handles
attachment or client switching.

- [Topics](./topics/) explain the loader pipeline and builder extension points.
- [Examples](./examples/) show expansion and building on an isolated server.
- [API](./api/) links the internal loading, building, and freezing interfaces.

The upstream [Internals documentation](https://tmuxp.git-pull.com/internals/)
contains the full architecture and module reference. Use the
[libtmux Python API](/reference/py/) for general tmux programming.
