---
port: cxx
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

Use `Server::sessions`, `Session::windows`, and `Window::panes`
to read each level of the hierarchy.

## All panes in a session

Use a session-wide pane collection when the task spans several windows, such
as finding a command or capturing output from every pane. A window linked to
multiple sessions still refers to the same tmux panes. Check whether the API
reads live state or traverses a captured graph before reusing its result.

`libtmux::Session::panes` runs a session-scoped `list-panes` command. Inspect
the returned result before traversing the panes.

## Up the hierarchy

Parent lookups may read captured data or query tmux again. Check the method's
read and failure semantics; [Server, session, window,
pane](/concepts/server-session-window-pane/) introduces that distinction:

Call `Pane::window` and `Window::session` to find an object’s parent.

## One walk, down and back up

List a session's windows, then look up a parent and compare its identity with
the starting object:

```cpp
auto sessions = server.sessions();       // expected<vector<Session>, CommandFailure>
const auto& session = sessions->at(0);

auto windows = session.windows();        // expected<vector<Window>, CommandFailure>
const auto& window = windows->at(0);

auto back = window.session();            // expected<Session, CommandFailure>
*back == session; // operator== is defined directly on Session/Window/Pane
```

## The active child

The active window and pane identify where untargeted input goes. Use their
accessors or inspect the active flags in a captured snapshot:

Call `Session::active_window` and `Window::active_pane`.

[Format-token fields](../format-tokens/) describes the underlying
`window_active` and `pane_active` fields.

## Is it in that collection?

Checking membership generally goes through whatever your language uses for
collection membership, since most of these calls already return an ordinary
array, slice, or list:

Use standard collection membership operations with the object identity
comparison described below.

## Is this the same object?

Compare IDs to determine whether two handles refer to the same tmux object on
the same server. Check what handle equality includes before using it as an
identity test:

`Session`, `Window`, and `Pane` define `operator==` for equality checks.
