---
title: "Workspace Manager for TypeScript"
description: "Build and converge tmux sessions with @libtmux/workspace."
port: ts
product: workspace
sidebar:
  label: Overview
  order: 0
tableOfContents: true
---

`@libtmux/workspace` applies a declared session layout to a libtmux `Server`.
Describe windows, panes, working directories, and shell commands as data.
Applying the same description again reuses matching objects.

The package manages tmux structure. It does not supervise processes or restart
commands that have exited. Commands run only in newly created panes by default.

## Start here

- [Guides](./guides/) install the package and apply a workspace.
- [Topics](./topics/) explain ownership, pruning, and command policy.
- [Examples](./examples/) show the source example and its integration checks.
- [API](./api/) connects parsing, planning, application, and failure types.

## Package and runtime

Use `@libtmux/workspace` alongside `libtmux`. The published package supports
Node and Bun; its YAML convenience parser requires Bun. You can use validated
JavaScript objects under either runtime. Real tmux control requires tmux on
the host. The package documents Linux as its supported runtime platform.

The workspace format uses familiar tmuxp field names, with its own validation
and convergence rules. Python plugins and tmuxp's configuration search are not
part of this package.

[Package documentation](https://github.com/libtmux/libtmux-ts/blob/f85b8de551353f746d50eaf36bf0112f4fe5a528/packages/workspace/README.md)
