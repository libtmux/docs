---
port: py
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

```python
pane.send_keys("echo hi")
pane.kill()
```

<a id="a-generated-data-table-under-a-hand-written-surface"></a>

## Reading tmux fields

Object IDs become tmux targets (`-t`). Format variables (`#{...}`) provide
the state returned by tmux.

`libtmux.constants` defines the format fields and their scope and tmux-version
requirements. `Obj` in `libtmux.neo` exposes the captured values as dataclass
fields. A field excluded by those requirements is `None`.

<a id="module-layout-by-port"></a>

## Source layout

`Server`, `Session`, `Window`, `Pane`, and `Client` each have their own module:
`src/libtmux/server.py`, `src/libtmux/session.py`, `src/libtmux/window.py`,
`src/libtmux/pane.py`, and `src/libtmux/client.py`.

`src/libtmux/common.py` holds shared behavior. `src/libtmux/neo.py` defines
the dataclass query layer, `src/libtmux/options.py` and `src/libtmux/hooks.py`
provide mixins, and `src/libtmux/exc.py` defines the exception hierarchy.
