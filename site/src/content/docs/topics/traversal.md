---
supportedPorts: [py, ts, rs, go, java, csharp, cxx, swift]
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

<!-- port:py -->
<!-- port:root -->
### Python
<!-- /port -->
Read `Server.sessions`, then `Session.windows` and `Window.panes`
to traverse from the server down to its panes.
<!-- /port -->

<!-- port:ts -->
<!-- port:root -->
### TypeScript
<!-- /port -->
Await `Server.sessions`, then read `Session.windows` and
`Window.panes` from the loaded graph.
<!-- /port -->

<!-- port:go -->
<!-- port:root -->
### Go
<!-- /port -->
Call `Server.Sessions` with a context to read the sessions.
`Session.Windows` and `Window.Panes` traverse their captured relationships.
<!-- /port -->

<!-- port:rs -->
<!-- port:root -->
### Rust
<!-- /port -->
Use `Server.sessions`, `Session.windows`, and `Window.panes`
to read each level of the hierarchy.
<!-- /port -->

<!-- port:java -->
<!-- port:root -->
### Java
<!-- /port -->
Use `Server.sessions`, `Session.windows`, and `Window.panes`
to read each level of the hierarchy.
<!-- /port -->

<!-- port:csharp -->
<!-- port:root -->
### C#
<!-- /port -->
Use `Server.GetSessionsAsync`, `Session.GetWindowsAsync`, and
`Window.GetPanesAsync` to read each level of the hierarchy.
<!-- /port -->

<!-- port:cxx -->
<!-- port:root -->
### C++
<!-- /port -->
Use `Server::sessions`, `Session::windows`, and `Window::panes`
to read each level of the hierarchy.
<!-- /port -->

<!-- port:swift -->
<!-- port:root -->
### Swift
<!-- /port -->
Read sessions through `Server.sessions()`. Once you have a
`Snapshot`, use its relationship queries, including `Snapshot.windows(of:)`,
to find the windows and panes for those captured objects.
<!-- /port -->

<!-- port:ts -->
`session.windows` and `window.panes` read the graph loaded by
`await server.sessions()` without additional tmux commands.
<!-- /port -->
<!-- port:rs -->
`server.attached_sessions()` lists only sessions with an attached client.
<!-- /port -->

## All panes in a session

Use a session-wide pane collection when the task spans several windows, such
as finding a command or capturing output from every pane. A window linked to
multiple sessions still refers to the same tmux panes. Check whether the API
reads live state or traverses a captured graph before reusing its result.

<!-- port:py -->
<!-- port:root -->
### Python
<!-- /port -->

`libtmux.Session.panes` runs a session-scoped `list-panes -s` read. Use it to
list panes across the session's windows without manually listing each window.
<!-- /port -->

<!-- port:ts -->
<!-- port:root -->
### TypeScript
<!-- /port -->

`session.Session.panes` returns a `Selection` from the session's captured
graph. Reading it does not issue another tmux command; refresh the snapshot
when you need newer state.
<!-- /port -->

<!-- port:rs -->
<!-- port:root -->
### Rust
<!-- /port -->

`session.Session.panes` performs a live listing and returns a `Result` from
the async call. Handle a command failure before using the returned panes.
<!-- /port -->

<!-- port:go -->
<!-- port:root -->
### Go
<!-- /port -->

`tmux.Session.Panes` reads captured relations without another tmux command.
The relation must have been included in the read that produced the session;
an uncaptured relation does not establish that the session has no panes.
<!-- /port -->

<!-- port:csharp -->
<!-- port:root -->
### C#
<!-- /port -->

`LibTmux.Session.Panes` reads the session's captured relations. It does not
issue a tmux command; an incomplete capture may lack the required relation.
<!-- /port -->

<!-- port:cxx -->
<!-- port:root -->
### C++
<!-- /port -->

`libtmux::Session::panes` runs a session-scoped `list-panes` command. Inspect
the returned result before traversing the panes.
<!-- /port -->

<!-- port:swift -->
<!-- port:root -->
### Swift
<!-- /port -->

`Snapshot.panes(of:)` accepts a session or a window. The session overload
traverses the captured graph and deduplicates pane IDs without a tmux read.
<!-- /port -->

<!-- port:java -->
<!-- port:root -->
### Java
<!-- /port -->

Java has no direct session-wide pane member. Traverse `Session.windows()`
and then `Window.panes()` in the captured relations. Deduplicate pane IDs
when combining results from sessions that may share linked windows.
<!-- /port -->

## Up the hierarchy

Parent lookups may read captured data or query tmux again. Check the method's
read and failure semantics; [Server, session, window,
pane](/concepts/server-session-window-pane/) introduces that distinction:

<!-- port:py -->
<!-- port:root -->
### Python
<!-- /port -->
Read `Pane.window` for a pane’s window and `Window.session` for
a window’s session.
<!-- /port -->

<!-- port:ts -->
<!-- port:root -->
### TypeScript
<!-- /port -->
`Pane.window` and `Window.session` are getters that follow the
relationships in the loaded graph.
<!-- /port -->

<!-- port:go -->
<!-- port:root -->
### Go
<!-- /port -->
`Pane.Window` returns `(Window, bool)` and `Window.Session` returns
`(Session, bool)`. Check the boolean before using the parent.
<!-- /port -->

<!-- port:rs -->
<!-- port:root -->
### Rust
<!-- /port -->
`Pane.window` and `Window.session` asynchronously return
`Result<Option<Window>, Error>` and `Result<Option<Session>, Error>`.
Handle both a command failure and an absent parent.
<!-- /port -->

<!-- port:java -->
<!-- port:root -->
### Java
<!-- /port -->
Call `Pane.window` and `Window.session` to find an object’s parent.
<!-- /port -->

<!-- port:csharp -->
<!-- port:root -->
### C#
<!-- /port -->
Read the `Pane.Window` and `Window.Session` properties.
<!-- /port -->

<!-- port:cxx -->
<!-- port:root -->
### C++
<!-- /port -->
Call `Pane::window` and `Window::session` to find an object’s parent.
<!-- /port -->

<!-- port:swift -->
<!-- port:root -->
### Swift
<!-- /port -->
Use `Pane.windowID` to look up the window in a `Snapshot`.
Find a window’s sessions through the snapshot’s relationships; a window
does not store a single session field.
<!-- /port -->

<!-- port:go -->
Check the boolean from a relationship lookup. It reports whether the relation
was captured, not whether the object still exists in tmux. Use a live read when
current existence matters.
<!-- /port -->
<!-- port:rs -->
Handle both a command failure and an absent parent in the optional result.
<!-- /port -->
<!-- port:csharp -->
`.Window`, `.Session`, `.ActiveWindow`, and `.ActivePane` read captured state
synchronously. They throw `IncompleteSnapshotException` when the capture lacks
the required context.
<!-- /port -->

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

```typescript
const session = (await server.sessions())[0];
const window = session.windows[0];
const pane = window.panes[0];

pane.window.id === window.id;
window.session.id === session.id;
```

```go
sessions, err := server.Sessions(ctx)
if err != nil {
    return err
}
for _, session := range sessions {
    windows, captured := session.Windows()
    if !captured {
        return fmt.Errorf("session %s has no windows", session.ID())
    }
    for _, window := range windows {
        back, captured := window.Session()
        if !captured {
            return fmt.Errorf("window %s has no captured session", window.ID())
        }
        same := back.ID() == session.ID()
        fmt.Println(window.ID(), "belongs to session:", same)
    }
}
```

```rust
let sessions = server.sessions().await?;
let session = &sessions[0];
let windows = session.windows().await?;
let window = &windows[0];

let back = window.session().await?; // Result<Option<Session>, Error>
back.is_some_and(|s| s.id() == session.id())
```

```java
Session session = server.sessions().get(0);
Window window = session.windows().get(0);

Session back = window.session();
back.equals(session);
```

```csharp
Session session = (await server.GetSessionsAsync())[0];
Window window = (await session.GetWindowsAsync())[0];

Session back = window.Session; // property, read from the captured snapshot
back.Equals(session);
```

```cpp
// expected<vector<Session>, CommandFailure>
auto sessions = server.sessions();
const auto& session = sessions->at(0);

// expected<vector<Window>, CommandFailure>
auto windows = session.windows();
const auto& window = windows->at(0);

auto back = window.session();            // expected<Session, CommandFailure>
*back == session; // operator== is defined directly on Session/Window/Pane
```

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

<!-- port:py -->
<!-- port:root -->
### Python
<!-- /port -->
Read `Session.active_window` and `Window.active_pane` for the
selected objects.
<!-- /port -->

<!-- port:ts -->
<!-- port:root -->
### TypeScript
<!-- /port -->
Read the `Session.activeWindow` and `Window.activePane` getters.
<!-- /port -->

<!-- port:go -->
<!-- port:root -->
### Go
<!-- /port -->
`Session.ActiveWindow` returns `(Window, bool)` and
`Window.ActivePane` returns `(Pane, bool)`. Check the boolean before use.
<!-- /port -->

<!-- port:rs -->
<!-- port:root -->
### Rust
<!-- /port -->
`Session.active_window` and `Window.active_pane` asynchronously
return `Result<Option<Window>, Error>` and `Result<Option<Pane>, Error>`.
Handle errors and the absence of an active object.
<!-- /port -->

<!-- port:java -->
<!-- port:root -->
### Java
<!-- /port -->
`Session.activeWindow` returns `Optional<Window>`, and
`Window.activePane` returns `Optional<Pane>`.
<!-- /port -->

<!-- port:csharp -->
<!-- port:root -->
### C#
<!-- /port -->
Read the `Session.ActiveWindow` and `Window.ActivePane` properties.
<!-- /port -->

<!-- port:cxx -->
<!-- port:root -->
### C++
<!-- /port -->
Call `Session::active_window` and `Window::active_pane`.
<!-- /port -->

<!-- port:swift -->
<!-- port:root -->
### Swift
<!-- /port -->
Filter the snapshot’s windows or panes by their `isActive` flag.
For example, inspect the windows returned by `Snapshot.windows(of:)`
for the selected session.
<!-- /port -->

<!-- port:swift -->
Filter snapshot children by `isActive`.
<!-- /port -->
[Format-token fields](../format-tokens/) describes the underlying
`window_active` and `pane_active` fields.

## Is it in that collection?

Checking membership generally goes through whatever your language uses for
collection membership, since most of these calls already return an ordinary
array, slice, or list:

<!-- port:py -->
`QueryList` supports `in`: use `window in session.windows` or
`pane in window.panes`.
<!-- /port -->
<!-- port:java,cxx,csharp -->
Use standard collection membership operations with the object identity
comparison described below.
<!-- /port -->
<!-- port:ts -->
`Selection<T>` is iterable. Iterate and compare IDs, or spread it into an array
for standard array operations.
<!-- /port -->
<!-- port:go -->
Iterate over the slice and compare each object's stable ID, such as `Pane.ID()`.
Confirm the objects belong to the same server before comparing IDs.
<!-- /port -->
<!-- port:rs -->
Iterate over the vector and compare each object's `id()`. Confirm the objects
belong to the same server before comparing IDs.
<!-- /port -->
<!-- port:swift -->
Use the collection's `contains(where:)` to compare IDs. Confirm the objects
belong to the same server before comparing IDs.
<!-- /port -->

## Is this the same object?

Compare IDs to determine whether two handles refer to the same tmux object on
the same server. Check what handle equality includes before using it as an
identity test:

<!-- port:py -->
<!-- port:root -->
### Python
<!-- /port -->
Compare `Window.window_id` or `Pane.pane_id` when checking whether
two handles name the same object on the same server.
<!-- /port -->

<!-- port:ts -->
<!-- port:root -->
### TypeScript
<!-- /port -->
Compare the handles’ `id` properties when checking identity on the
same server.
<!-- /port -->

<!-- port:go -->
<!-- port:root -->
### Go
<!-- /port -->
Compare `Pane.ID` values. `PaneID` is a string type and supports
`==`; include the server context when comparing objects from different servers.
<!-- /port -->

<!-- port:rs -->
<!-- port:root -->
### Rust
<!-- /port -->
Compare `Pane.id` values when checking identity on the same server.
<!-- /port -->

<!-- port:java -->
<!-- port:root -->
### Java
<!-- /port -->
`Pane.equals` compares the server identity and pane ID.
<!-- /port -->

<!-- port:csharp -->
<!-- port:root -->
### C#
<!-- /port -->
`Pane.Equals` compares a generation counter and the pane ID.
<!-- /port -->

<!-- port:cxx -->
<!-- port:root -->
### C++
<!-- /port -->
`Session`, `Window`, and `Pane` define `operator==` for equality checks.
<!-- /port -->

<!-- port:swift -->
<!-- port:root -->
### Swift
<!-- /port -->
Compare the `id` values when checking identity on the same server.
The equality behavior described below also includes captured state.
<!-- /port -->

<!-- port:swift -->
**Swift's equality compares captured state.** Compiler-synthesized equality for
`Session`, `Window`, and `Pane` compares every stored property, including
dimensions and current command. Two reads can compare unequal even when they
describe the same tmux object. Compare `.id` when checking identity on the same
server.
<!-- /port -->
