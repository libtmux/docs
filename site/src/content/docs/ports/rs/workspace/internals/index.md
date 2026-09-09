---
title: "Rust workspace internals"
description: "Architecture and development interfaces of the Rust workspace builder."
port: rs
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

`Workspace::from_yaml` parses the description. `WorkspaceBuilder` turns it
into a command plan or builds a new session through a borrowed `Server`.
`freeze` reads a session back into workspace data. The caller supplies file
reading, the async runtime, command-line handling, and attachment.

## Read the implementation

- [Guides](./guides/) show builder setup and application code.
- [Topics](./topics/) explain configuration, behavior, and failures.
- [Examples](./examples/) exercise the builder through the language API.
- [API](./api/) links the configuration and construction interfaces.

## Implementation scope

`tmux-workspace` creates a tmux session from a
[tmuxp](https://tmuxp.git-pull.com)-style YAML description.
The crate uses the public libtmux API and returns a typed session handle. A
separate `freeze` operation records an existing session as workspace data.

Building creates a new session. It refuses an already existing session with
the requested name, so repeated builds require a new name or explicit cleanup.

## Package and runtime

Add `tmux-workspace` separately from the core crate. Workspace creation and
freezing are asynchronous and require a running Tokio runtime and tmux on the
host. Pin a prerelease explicitly; a stable-only Cargo requirement does not
select an alpha release.

The format covers a subset of tmuxp. Unknown keys are recorded in
`unsupported_keys` by
the parser. Review those lists before assuming a Python workspace's setup
hooks or configuration have taken effect.

[Crate documentation](https://github.com/libtmux/libtmux-rs/blob/9331cdf556ea7a1f2589e9c3e6cece6ccdc7765c/crates/tmux-workspace/README.md)
