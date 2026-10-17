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

`crates/libtmux/src/formats.rs` defines the format catalog. Each entry records
the tmux name, required context, first supported release, decoder, and handling
of empty values. `crates/libtmux/src/snapshot.rs` uses that catalog to decode
captured fields.

Handle accessors such as `Pane.current_command` return `Option<T>` when a
value can be absent. Typed field queries return `Availability`, which also
distinguishes an unsupported field from an absent value. See
[Format-token fields](../format-tokens/) for field availability.

<a id="module-layout-by-port"></a>

## Source layout

`Server`, `Session`, `Window`, and `Pane` are defined in
`crates/libtmux/src/server.rs`, `crates/libtmux/src/session.rs`,
`crates/libtmux/src/window.rs`, and `crates/libtmux/src/pane.rs`.
Their additional operations live in `crates/libtmux/src/server/`,
`crates/libtmux/src/session/`, `crates/libtmux/src/window/`, and
`crates/libtmux/src/pane/`.

The [options and hooks](../options-and-hooks/) methods are grouped in
`crates/libtmux/src/server/settings.rs`,
`crates/libtmux/src/session/settings.rs`,
`crates/libtmux/src/window/settings.rs`, and
`crates/libtmux/src/pane/settings.rs`.
`crates/libtmux/src/hooks.rs` defines `IndexedHooks` and `SparseValues`;
`crates/libtmux/src/options.rs` defines option schemas and values.
Workspaces and the MCP server are separate crates under
`crates/tmux-workspace/` and `crates/tmux-mcp/`.
