---
port: py
route: topics/traversal
title: Traversal
description: Moving up and down the server/session/window/pane tree, and the two questions that come up once you have more than one object.
sidebar:
  label: Traversal
  group: Topics
  order: 3
tableOfContents: true
---

Use relationships to move between sessions, windows, and panes. [Server,
session, window, pane](/concepts/server-session-window-pane/) explains the
hierarchy and snapshot model. This page covers relationship calls, collection
membership, and object identity.

## Down the hierarchy

List children through the parent object or a captured snapshot. Whether a read
issues another tmux command depends on the API, independently of whether the
call is async; see [Server, session, window,
pane](/concepts/server-session-window-pane/).

Read `Server.sessions`, then `Session.windows` and `Window.panes`
to traverse from the server down to its panes.

## All panes in a session

Use a session-wide pane collection when the task spans several windows, such
as finding a command or capturing output from every pane. A window linked to
multiple sessions still refers to the same tmux panes. Check whether the API
reads live state or traverses a captured graph before reusing its result.

`libtmux.Session.panes` runs a session-scoped `list-panes -s` read. Use it to
list panes across the session's windows without manually listing each window.

## Up the hierarchy

Parent lookups may read captured data or query tmux again. Check the method's
read and failure semantics; [Server, session, window,
pane](/concepts/server-session-window-pane/) introduces that distinction:

Read `Pane.window` for a pane’s window and `Window.session` for
a window’s session.

## One walk, down and back up

List a session's windows, then look up a parent and compare its identity with
the starting object:

```python
session = server.sessions[0]
window = session.windows[0]
pane = window.panes[0]

pane.window.window_id == window.window_id
window.session.session_id == session.session_id
```

## The active child

The active window and pane identify where untargeted input goes. Use their
accessors or inspect the active flags in a captured snapshot:

Read `Session.active_window` and `Window.active_pane` for the
selected objects.

[Format-token fields](../format-tokens/) describes the underlying
`window_active` and `pane_active` fields.

## Is it in that collection?

Checking membership generally goes through whatever your language uses for
collection membership, since most of these calls already return an ordinary
array, slice, or list:

`QueryList` supports `in`: use `window in session.windows` or
`pane in window.panes`.

## Is this the same object?

Compare IDs to determine whether two handles refer to the same tmux object on
the same server. Check what handle equality includes before using it as an
identity test:

Compare `Window.window_id` or `Pane.pane_id` when checking whether
two handles name the same object on the same server.
