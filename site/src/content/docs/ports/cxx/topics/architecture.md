---
port: cxx
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

```cpp
pane->send_text("echo hi");
pane->kill();
```

<a id="a-generated-data-table-under-a-hand-written-surface"></a>

## Reading tmux fields

Object IDs become tmux targets (`-t`). Format variables (`#{...}`) provide
the state returned by tmux.

Handles capture a fixed set of non-optional fields. Use
`pane->expand("#{...}")` for tokens outside those fields.
[Format-token fields](../format-tokens/) covers their interpretation.

<a id="module-layout-by-port"></a>

## Source layout

`include/libtmux/entities.hpp` declares `Session`, `Window`, and `Pane`.
Their method bodies live in `src/`. `include/libtmux/server.hpp`,
`include/libtmux/options.hpp`, and `include/libtmux/capabilities.hpp`
define server operations, options, and capability checks.

The `include/libtmux/testing/` component is separate from the library;
[Context managers](../context-managers/) explains its test-server ownership.
