---
port: swift
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

Read sessions through `Server.sessions()`. Once you have a
`Snapshot`, use its relationship queries, including `Snapshot.windows(of:)`,
to find the windows and panes for those captured objects.

## All panes in a session

Use a session-wide pane collection when the task spans several windows, such
as finding a command or capturing output from every pane. A window linked to
multiple sessions still refers to the same tmux panes. Check whether the API
reads live state or traverses a captured graph before reusing its result.

`Snapshot.panes(of:)` accepts a session or a window. The session overload
traverses the captured graph and deduplicates pane IDs without a tmux read.

## Up the hierarchy

Parent lookups may read captured data or query tmux again. Check the method's
read and failure semantics; [Server, session, window,
pane](/concepts/server-session-window-pane/) introduces that distinction:

Use `Pane.windowID` to look up the window in a `Snapshot`.
Find a window’s sessions through the snapshot’s relationships; a window
does not store a single session field.

## One walk, down and back up

List a session's windows, then look up a parent and compare its identity with
the starting object:

```swift
let sessions = try await server.sessions()
let session = sessions[0]

let snapshot = try await server.snapshot()
let window = snapshot.windows(of: session)[0]
let pane = snapshot.panes(of: window)[0]

// An array, not one Session: link-window can put a window in more than one.
snapshot.sessions(of: window).contains(session)
```

## The active child

The active window and pane identify where untargeted input goes. Use their
accessors or inspect the active flags in a captured snapshot:

Filter the snapshot’s windows or panes by their `isActive` flag.
For example, inspect the windows returned by `Snapshot.windows(of:)`
for the selected session.

Filter snapshot children by `isActive`.
[Format-token fields](../format-tokens/) describes the underlying
`window_active` and `pane_active` fields.

## Is it in that collection?

Checking membership generally goes through whatever your language uses for
collection membership, since most of these calls already return an ordinary
array, slice, or list:

Use the collection's `contains(where:)` to compare IDs. Confirm the objects
belong to the same server before comparing IDs.

## Is this the same object?

Compare IDs to determine whether two handles refer to the same tmux object on
the same server. Check what handle equality includes before using it as an
identity test:

Compare the `id` values when checking identity on the same server.
The equality behavior described below also includes captured state.

**Swift's equality compares captured state.** Compiler-synthesized equality for
`Session`, `Window`, and `Pane` compares every stored property, including
dimensions and current command. Two reads can compare unequal even when they
describe the same tmux object. Compare `.id` when checking identity on the same
server.
