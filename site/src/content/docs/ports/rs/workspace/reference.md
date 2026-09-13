---
title: "Rust workspace builder API"
description: "Internal reference for the Rust workspace builder and configuration APIs."
port: rs
product: workspace
sidebar:
  group: Internals
  label: API
  order: 4
tableOfContents: true
---

The `tmux_workspace` crate exports its configuration types, builder, and
`freeze` function. The core libtmux server and session remain the handles used
for actual tmux operations.

## Configuration

[`Workspace`](/reference/rs/config-workspace/) holds the session description.
`Workspace::from_yaml` parses it, and `to_yaml` emits its YAML representation.
`WindowConfig` and `PaneConfig` describe the nested objects; `ConfigError`
identifies invalid configuration.

## Builder

[`WorkspaceBuilder`](/reference/rs/src-workspacebuilder/) borrows a `Server`.
`new` selects that server, `plan` returns the inert construction plan, and
`build` asynchronously creates the requested session. Keep the server alive
for the builder's lifetime.

`BuildError` distinguishes configuration errors, underlying libtmux errors,
refused operations, a missing initial window, and an existing session name.
Successful completion returns a `Session`; failure does not imply rollback.

## Export

`freeze(&Session)` asynchronously produces a `Workspace` describing the live
session. Serialize that result with `to_yaml`. The exported structure is
suitable for review and editing; it cannot restore process memory or recover
an original shell command from a running program.

[Public exports and builder](https://github.com/libtmux/libtmux-rs/blob/9331cdf556ea7a1f2589e9c3e6cece6ccdc7765c/crates/tmux-workspace/src/lib.rs); [Freeze API](https://github.com/libtmux/libtmux-rs/blob/9331cdf556ea7a1f2589e9c3e6cece6ccdc7765c/crates/tmux-workspace/src/freeze.rs).
