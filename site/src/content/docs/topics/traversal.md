---
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

| Port | Server → sessions | Session → windows | Window → panes |
|------|--------------------|--------------------|-----------------|
| Python | `server.sessions` | `session.windows` | `window.panes` |
| TypeScript | `await server.sessions()` | `session.windows` | `window.panes` |
| Go | `server.Sessions(ctx)` | `session.Windows()` | `window.Panes()` |
| Rust | `await server.sessions()` | `session.windows()` | `window.panes()` |
| Java | `server.sessions()` | `session.windows()` | `window.panes()` |
| .NET | `server.GetSessionsAsync()` | `session.GetWindowsAsync()` | `window.GetPanesAsync()` |
| C++ | `server->sessions()` | `session->windows()` | `window->panes()` |
| Swift | `server.sessions()`, or `snapshot.windows(of: session)` for windows/panes once you have a `Snapshot` | see previous column | see previous column |

TypeScript's `session.windows` and `window.panes` read the graph loaded by
`await server.sessions()` without additional tmux commands. Rust also provides
`server.attached_sessions()` to list only sessions with an attached client.

## All panes in a session

Use a session-wide pane collection when the task spans several windows, such
as finding a command or capturing output from every pane. A window linked to
multiple sessions still refers to the same tmux panes. Check whether the API
reads live state or traverses a captured graph before reusing its result.

### Python

`libtmux.Session.panes` runs a session-scoped `list-panes -s` read. Use it to
list panes across the session's windows without manually listing each window.

### TypeScript

`session.Session.panes` returns a `Selection` from the session's captured
graph. Reading it does not issue another tmux command; refresh the snapshot
when you need newer state.

### Rust

`session.Session.panes` performs a live listing and returns a `Result` from
the async call. Handle a command failure before using the returned panes.

### Go

`tmux.Session.Panes` reads captured relations without another tmux command.
The relation must have been included in the read that produced the session;
an uncaptured relation does not establish that the session has no panes.

### .NET

`LibTmux.Session.Panes` reads the session's captured relations. It does not
issue a tmux command; an incomplete capture may lack the required relation.

### C++

`libtmux::Session::panes` runs a session-scoped `list-panes` command. Inspect
the returned result before traversing the panes.

### Swift

`Snapshot.panes(of:)` accepts a session or a window. The session overload
traverses the captured graph and deduplicates pane IDs without a tmux read.

### Java

Java has no direct session-wide pane member. Traverse `Session.windows()`
and then `Window.panes()` in the captured relations. Deduplicate pane IDs
when combining results from sessions that may share linked windows.

## Up the hierarchy

Parent lookups may read captured data or query tmux again. Check the method's
read and failure semantics; [Server, session, window,
pane](/concepts/server-session-window-pane/) introduces that distinction:

| Port | Pane → window | Window → session |
|------|----------------|--------------------|
| Python | `pane.window` | `window.session` |
| TypeScript | `pane.window` (getter, from the loaded graph) | `window.session` (getter) |
| Go | `pane.Window()` → `(Window, bool)` | `window.Session()` → `(Session, bool)` |
| Rust | `await pane.window()` → `Result<Option<Window>, Error>` | `await window.session()` → `Result<Option<Session>, Error>` |
| Java | `pane.window()` | `window.session()` |
| .NET | `pane.Window` (property) | `window.Session` (property) |
| C++ | `pane->window()` | `window->session()` |
| Swift | `pane.windowID`, then look it up via `Snapshot` | not a per-window field: join through the snapshot instead |

Go and Rust return optional relationship results. .NET's `.Window`, `.Session`,
`.ActiveWindow`, and `.ActivePane` read captured state synchronously and throw
`IncompleteSnapshotException` if that capture lacks the required context.

## One walk, down and back up

Start with a session, traverse to a window and pane, then look up the parent and
compare its identity with the starting object:

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
session := sessions[0]
windows, err := session.Windows()
window := windows[0]

back, ok := window.Session() // ok is false if the window outlived it
back.ID() == session.ID()
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
auto sessions = server.sessions();       // expected<vector<Session>, CommandFailure>
const auto& session = sessions->at(0);

auto windows = session.windows();        // expected<vector<Window>, CommandFailure>
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

"Which window is in front right now" and "which pane would a command
actually reach" are common enough questions that most ports expose the
active child directly rather than making you filter a list:

| Port | Session's active window | Window's active pane |
|------|---------------------------|------------------------|
| Python | `session.active_window` | `window.active_pane` |
| TypeScript | `session.activeWindow` (getter) | `window.activePane` (getter) |
| Go | `session.ActiveWindow()` → `(Window, bool)` | `window.ActivePane()` → `(Pane, bool)` |
| Rust | `await session.active_window()` → `Result<Option<Window>, Error>` | `await window.active_pane()` → `Result<Option<Pane>, Error>` |
| Java | `session.activeWindow()` → `Optional<Window>` | `window.activePane()` → `Optional<Pane>` |
| .NET | `session.ActiveWindow` (property) | `window.ActivePane` (property) |
| C++ | `session->active_window()` | `window->active_pane()` |
| Swift | filter for `isActive` on `snapshot.windows(of: session)`: `Window` carries its own `window_active` flag rather than the session exposing an accessor | same pattern, on the pane's own active flag |

In Swift, filter snapshot children by `isActive`. Other ports expose an
active-child method or property on the parent. [Format-token
fields](../format-tokens/) describes the underlying `window_active` and
`pane_active` fields.

## Is it in that collection?

Checking membership generally goes through whatever your language uses for
collection membership, since most of these calls already return an ordinary
array, slice, or list:

- **Python** overloads `in` directly on its `QueryList`: `window in
  session.windows`, `pane in window.panes`.
- **Java**, **C++**, and **.NET** return standard collections. Use their
  standard membership operations with the identity comparison appropriate to the
  port.
- **TypeScript** returns iterable `Selection<T>` objects. Iterate over the
  selection and compare IDs, or spread it into an array for standard array
  operations.
- **Go** and **Rust** return slices or vectors. Iterate and compare object IDs
  when testing membership by tmux identity.

## Is this the same object?

Compare IDs to determine whether two handles refer to the same tmux object on
the same server. Equality operators vary by port:

| Port | How you check |
|------|----------------|
| Python | `window.window_id == other.window_id` (or `pane.pane_id == ...`) |
| TypeScript | compare `.id` |
| Go | `pane.ID() == other.ID()`: `PaneID` is a plain, `==`-comparable `string` |
| Rust | `pane.id() == other.id()`: verified from the port's own doctests, not struct equality |
| Java | `pane.equals(other)`: overridden to compare server identity plus pane ID |
| .NET | `pane.Equals(other)`: overridden to compare a generation counter plus ID |
| C++ | `pane == other`: `operator==` is defined directly on `Session`/`Window`/`Pane` |
| Swift | compare `.id` for identity; see the equality note below |

**Swift's equality compares captured state.** Compiler-synthesized equality for
`Session`, `Window`, and `Pane` compares every stored property, including
dimensions and current command. Two reads can compare unequal even when they
describe the same tmux object. Compare `.id` when checking identity on the same
server.
