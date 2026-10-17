---
port: ts
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

Await `Server.sessions`, then read `Session.windows` and
`Window.panes` from the loaded graph.

`session.windows` and `window.panes` read the graph loaded by
`await server.sessions()` without additional tmux commands.

## All panes in a session

Use a session-wide pane collection when the task spans several windows, such
as finding a command or capturing output from every pane. A window linked to
multiple sessions still refers to the same tmux panes. Check whether the API
reads live state or traverses a captured graph before reusing its result.

`session.Session.panes` returns a `Selection` from the session's captured
graph. Reading it does not issue another tmux command; refresh the snapshot
when you need newer state.

## Up the hierarchy

Parent lookups may read captured data or query tmux again. Check the method's
read and failure semantics; [Server, session, window,
pane](/concepts/server-session-window-pane/) introduces that distinction:

`Pane.window` and `Window.session` are getters that follow the
relationships in the loaded graph.

## One walk, down and back up

List a session's windows, then look up a parent and compare its identity with
the starting object:

```typescript
const session = (await server.sessions())[0];
const window = session.windows[0];
const pane = window.panes[0];

pane.window.id === window.id;
window.session.id === session.id;
```

## The active child

The active window and pane identify where untargeted input goes. Use their
accessors or inspect the active flags in a captured snapshot:

Read the `Session.activeWindow` and `Window.activePane` getters.

[Format-token fields](../format-tokens/) describes the underlying
`window_active` and `pane_active` fields.

## Is it in that collection?

Checking membership generally goes through whatever your language uses for
collection membership, since most of these calls already return an ordinary
array, slice, or list:

`Selection<T>` is iterable. Iterate and compare IDs, or spread it into an array
for standard array operations.

## Is this the same object?

Compare IDs to determine whether two handles refer to the same tmux object on
the same server. Check what handle equality includes before using it as an
identity test:

Compare the handles’ `id` properties when checking identity on the
same server.
