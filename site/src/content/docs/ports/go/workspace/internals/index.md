---
title: "Go workspace internals"
description: "Architecture and development interfaces of the Go workspace builder."
port: go
product: workspace
sidebar:
  label: Overview
  group: Internals
  order: 0
tableOfContents: true
---

Build and inspect tmux sessions from application code with the workspace
library. To load files from a terminal, start with the
[native CLI walkthrough](../guides/installation/).

## Builder pipeline

`Parse` validates the YAML before tmux construction begins. `Build` creates
the session and owns a temporary control connection for construction;
`BuildInto` uses an existing session connection. The caller supplies file
reading, deadlines, command-line handling, and attachment.

## Read the implementation

- [Guides](./guides/) show builder setup and application code.
- [Topics](./topics/) explain configuration, behavior, and failures.
- [Examples](./examples/) exercise the builder through the language API.
- [API](../reference/) links the configuration and construction interfaces.

## Implementation scope

The `workspace` module parses YAML
and builds a session through libtmux's Go API. It is a separate module, so
applications using only the core client do not acquire a YAML dependency.

Parsing validates the whole document before construction. Building returns
the created session, including a session handle alongside an error when later
operations fail and leave a partial workspace.

## Package and runtime

Import [`github.com/libtmux/libtmux-go/workspace`](https://pkg.go.dev/github.com/libtmux/libtmux-go/workspace) together with the core `tmux`
package. Building requires tmux on the host. Parsing and configuration
validation do not start a tmux server.

The module accepts windows, panes, commands, options, environment variables
and working directories. Plugin declarations and `before_script` are rejected.
Check the [configuration contract](./topics/) before loading an existing file.

[Workspace module documentation](https://github.com/libtmux/libtmux-go/blob/5f808882015a975a65acc7f9da5b3ff0d5cbdc91/workspace/README.md)
