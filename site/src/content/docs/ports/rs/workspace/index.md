---
title: "Workspace Manager for Rust"
description: "Build tmux sessions from YAML and export live layouts with tmux-workspace."
port: rs
product: workspace
sidebar:
  label: Overview
  order: 0
tableOfContents: true
---

`tmux-workspace` creates a tmux session from a tmuxp-style YAML description.
The crate uses the public libtmux API and returns a typed session handle. A
separate `freeze` operation records an existing session as workspace data.

Building creates a new session. It refuses an already existing session with
the requested name, so repeated builds require a new name or explicit cleanup.

## Start here

- [Guides](./guides/) install the crate and build a workspace.
- [Topics](./topics/) explain plans, parsing, failures, and export limits.
- [Examples](./examples/) build and freeze an isolated session.
- [API](./api/) covers the public configuration and builder types.

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
