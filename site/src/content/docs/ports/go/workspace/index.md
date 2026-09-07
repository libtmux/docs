---
title: "Workspace Manager for Go"
description: "Parse tmuxp-style YAML and build sessions with the Go workspace module."
port: go
product: workspace
sidebar:
  label: Overview
  order: 0
tableOfContents: true
---

The `workspace` module parses [tmuxp](https://tmuxp.git-pull.com)-style YAML
and builds a session through libtmux's Go API. It is a separate module, so
applications using only the core client do not acquire a YAML dependency.

Parsing validates the whole document before construction. Building returns
the created session, including a session handle alongside an error when later
operations fail and leave a partial workspace.

## Start here

- [Guides](./guides/) install the module and choose a build operation.
- [Topics](./topics/) explain validation, connection ownership, and tmuxp
  limits.
- [Examples](./examples/) include the executable Go examples.
- [API](./api/) covers parsing, building, and configuration values.

## Package and runtime

Import [`github.com/libtmux/libtmux-go/workspace`](https://pkg.go.dev/github.com/libtmux/libtmux-go/workspace) together with the core `tmux`
package. Building requires tmux on the host. Parsing and configuration
validation do not start a tmux server.

The module supports tmuxp field names for windows, panes, commands, options,
environment variables, and working directories. Python plugins and
`before_script` are rejected. Inspect the supported subset when moving an
existing Python workspace to Go.

[Workspace module documentation](https://github.com/libtmux/libtmux-go/blob/5f808882015a975a65acc7f9da5b3ff0d5cbdc91/workspace/README.md)
