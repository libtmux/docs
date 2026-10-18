---
port: rs
route: topics/architecture
title: Architecture
description: Locate operations, distinguish snapshots from live commands, and find their implementation.
sidebar:
  label: Architecture
  group: Topics
  order: 2
tableOfContents: true
---

A server handle selects a tmux server. Object IDs select sessions, windows, and
panes within it. For the object hierarchy and stable IDs, start with [Server,
session, window, pane](/concepts/server-session-window-pane/).

The source paths and async calls below belong to `libtmux-tokio`, imported as
`libtmux_tokio`. `libtmux` contains the blocking client and shared protocol
values. See [Standard-library core](../../concepts/standard-library-core/)
for the dependency boundary and package choices.

<a id="where-behavior-lives-on-the-object-or-through-the-server"></a>

## Calling operations

Session, window, and pane handles carry their ID and server context. Call an
operation on the object you want to change. The examples below send input and
kill that pane.

```rust
pane.send_line("echo hi").await?;
pane.kill().await?; // consumes the handle: see Context managers
```

<a id="a-generated-data-table-under-a-hand-written-surface"></a>

## Reading tmux fields

Object IDs become tmux targets (`-t`). Format variables (`#{...}`) provide
the state returned by tmux.

`crates/libtmux-tokio/src/formats.rs` defines the format catalog. Each entry
records
the tmux name, required context, first supported release, decoder, and handling
of empty values. `crates/libtmux-tokio/src/snapshot.rs` uses that catalog to
decode
captured fields.

Handle accessors such as [`Pane.current_command`](../../reference/libtmux_tokio-pane-pane-current_command/) return `Option<T>` when a
value can be absent. Typed field queries return `Availability`, which also
distinguishes an unsupported field from an absent value. See
[Format-token fields](../format-tokens/) for field availability.

<a id="module-layout-by-port"></a>

## Source layout

[`Server`](../../reference/libtmux_tokio-server-server/), [`Session`](../../reference/libtmux_tokio-session-session/), [`Window`](../../reference/libtmux_tokio-window-window/), and [`Pane`](../../reference/libtmux_tokio-pane-pane/) are defined in
`crates/libtmux-tokio/src/server.rs`, `crates/libtmux-tokio/src/session.rs`,
`crates/libtmux-tokio/src/window.rs`, and `crates/libtmux-tokio/src/pane.rs`.
Their additional operations live in `crates/libtmux-tokio/src/server/`,
`crates/libtmux-tokio/src/session/`, `crates/libtmux-tokio/src/window/`, and
`crates/libtmux-tokio/src/pane/`.

The [options and hooks](../options-and-hooks/) methods are grouped in
`crates/libtmux-tokio/src/server/settings.rs`,
`crates/libtmux-tokio/src/session/settings.rs`,
`crates/libtmux-tokio/src/window/settings.rs`, and
`crates/libtmux-tokio/src/pane/settings.rs`.
`crates/libtmux-tokio/src/hooks.rs` defines `IndexedHooks` and `SparseValues`;
`crates/libtmux-tokio/src/options.rs` defines option schemas and values.
Workspaces and the MCP server are separate crates under
`crates/tmux-workspace/` and `crates/tmux-mcp/`.
