---
port: java
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

```java
pane.sendLine("echo hi");
pane.kill();
```

<a id="a-generated-data-table-under-a-hand-written-surface"></a>

## Reading tmux fields

Object IDs become tmux targets (`-t`). Format variables (`#{...}`) provide
the state returned by tmux.

Typed field classes such as `Pane_` and `Session_` support the query layer.
Accessors use `Optional<T>` for fields that may be unavailable on the running
tmux version. [Filtering and queries](/concepts/queries/) explains how to
select and query those fields.

<a id="module-layout-by-port"></a>

## Source layout

`libtmux/src/main/java/io/github/libtmux/` holds the `Server`, `Session`,
`Window`, and `Pane` classes. Their `options()` and `hooks()` accessors
return `Options` and `Hooks` views scoped to the object.
`Session_`, `Window_`, and `Pane_` are typed-field classes for the query layer.
