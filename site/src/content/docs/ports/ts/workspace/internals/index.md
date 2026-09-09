---
title: "TypeScript workspace internals"
description: "Architecture and development interfaces of the TypeScript workspace builder."
port: ts
product: workspace
sidebar:
  label: Overview
  group: Internals
  order: 0
tableOfContents: true
---

These pages document the in-development workspace builder for contributors
and applications that call its APIs. For workspace loading from a terminal,
see [tmuxp](https://tmuxp.git-pull.com/).

## Builder pipeline

`parseWorkspace` validates input data. `planWorkspace` inspects the target
session and reports proposed topology changes; `applyWorkspace` performs the
changes through a caller-owned `Server`. The caller supplies file reading,
command-line handling, attachment, and application lifetime.

## Read the implementation

- [Guides](./guides/) show builder setup and application code.
- [Topics](./topics/) explain configuration, behavior, and failures.
- [Examples](./examples/) exercise the builder through the language API.
- [API](./api/) links the configuration and construction interfaces.

## Implementation scope

`@libtmux/workspace` applies a declared session layout to a libtmux `Server`.
Describe windows, panes, working directories, and shell commands as data.
Applying the same description again reuses matching objects.

The package manages tmux structure. It does not supervise processes or restart
commands that have exited. Commands run only in newly created panes by default.

## Package and runtime

Use `@libtmux/workspace` alongside `libtmux`. The published package supports
Node and Bun; its YAML convenience parser requires Bun. You can use validated
JavaScript objects under either runtime. Real tmux control requires tmux on
the host. The package documents Linux as its supported runtime platform.

The workspace format uses familiar [tmuxp](https://tmuxp.git-pull.com) field
names, with its own validation and convergence rules. Python plugins and
tmuxp's configuration search are not part of this package.

[Package documentation](https://github.com/libtmux/libtmux-ts/blob/f85b8de551353f746d50eaf36bf0112f4fe5a528/packages/workspace/README.md)
