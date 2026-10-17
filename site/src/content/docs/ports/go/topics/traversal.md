---
port: go
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

Call `Server.Sessions` with a context to read the sessions.
`Session.Windows` and `Window.Panes` traverse their captured relationships.

## All panes in a session

Use a session-wide pane collection when the task spans several windows, such
as finding a command or capturing output from every pane. A window linked to
multiple sessions still refers to the same tmux panes. Check whether the API
reads live state or traverses a captured graph before reusing its result.

`tmux.Session.Panes` reads captured relations without another tmux command.
The relation must have been included in the read that produced the session;
an uncaptured relation does not establish that the session has no panes.

## Up the hierarchy

Parent lookups may read captured data or query tmux again. Check the method's
read and failure semantics; [Server, session, window,
pane](/concepts/server-session-window-pane/) introduces that distinction:

`Pane.Window` returns `(Window, bool)` and `Window.Session` returns
`(Session, bool)`. Check the boolean before using the parent.

Check the boolean from a relationship lookup. It reports whether the relation
was captured, not whether the object still exists in tmux. Use a live read when
current existence matters.

## One walk, down and back up

List a session's windows, then look up a parent and compare its identity with
the starting object:

```go
sessions, err := server.Sessions(ctx)
if err != nil {
    return err
}
for _, session := range sessions {
    windows, captured := session.Windows()
    if !captured {
        return fmt.Errorf("session %s has no captured window relations", session.ID())
    }
    for _, window := range windows {
        back, captured := window.Session()
        if !captured {
            return fmt.Errorf("window %s has no captured session", window.ID())
        }
        fmt.Println(window.ID(), "belongs to session:", back.ID() == session.ID())
    }
}
```

## The active child

The active window and pane identify where untargeted input goes. Use their
accessors or inspect the active flags in a captured snapshot:

`Session.ActiveWindow` returns `(Window, bool)` and
`Window.ActivePane` returns `(Pane, bool)`. Check the boolean before use.

[Format-token fields](../format-tokens/) describes the underlying
`window_active` and `pane_active` fields.

## Is it in that collection?

Checking membership generally goes through whatever your language uses for
collection membership, since most of these calls already return an ordinary
array, slice, or list:

Iterate over the slice and compare each object's stable ID, such as `Pane.ID()`.
Confirm the objects belong to the same server before comparing IDs.

## Is this the same object?

Compare IDs to determine whether two handles refer to the same tmux object on
the same server. Check what handle equality includes before using it as an
identity test:

Compare `Pane.ID` values. `PaneID` is a string type and supports
`==`; include the server context when comparing objects from different servers.
