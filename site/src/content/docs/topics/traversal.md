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

| Port | Server → sessions | Session → windows | Window → panes |
|------|--------------------|--------------------|-----------------|
<!-- port:py -->| Python | `server.sessions` | `session.windows` | `window.panes` |
<!-- /port --><!-- port:ts -->| TypeScript | `await server.sessions()` | `session.windows` | `window.panes` |
<!-- /port --><!-- port:go -->| Go | `server.Sessions(ctx)` | `session.Windows()` | `window.Panes()` |
<!-- /port --><!-- port:rs -->| Rust | `await server.sessions()` | `session.windows()` | `window.panes()` |
<!-- /port --><!-- port:java -->| Java | `server.sessions()` | `session.windows()` | `window.panes()` |
<!-- /port --><!-- port:csharp -->| C# | `server.GetSessionsAsync()` | `session.GetWindowsAsync()` | `window.GetPanesAsync()` |
<!-- /port --><!-- port:cxx -->| C++ | `server->sessions()` | `session->windows()` | `window->panes()` |
<!-- /port --><!-- port:swift -->| Swift | `Server.sessions()`, or `snapshot.windows(of: session)` for windows/panes once you have a `Snapshot` | see previous column | see previous column |
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

| Port | Pane → window | Window → session |
|------|----------------|--------------------|
<!-- port:py -->| Python | `pane.window` | `window.session` |
<!-- /port --><!-- port:ts -->| TypeScript | `pane.window` (getter, from the loaded graph) | `window.session` (getter) |
<!-- /port --><!-- port:go -->| Go | `pane.Window()` → `(Window, bool)` | `window.Session()` → `(Session, bool)` |
<!-- /port --><!-- port:rs -->| Rust | `await pane.window()` → `Result<Option<Window>, Error>` | `await window.session()` → `Result<Option<Session>, Error>` |
<!-- /port --><!-- port:java -->| Java | `pane.window()` | `window.session()` |
<!-- /port --><!-- port:csharp -->| C# | `pane.Window` (property) | `window.Session` (property) |
<!-- /port --><!-- port:cxx -->| C++ | `pane->window()` | `window->session()` |
<!-- /port --><!-- port:swift -->| Swift | `pane.windowID`, then look it up via `Snapshot` | not a per-window field: join through the snapshot instead |
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
<!-- port:py -->| Python | `session.active_window` | `window.active_pane` |
<!-- /port --><!-- port:ts -->| TypeScript | `session.activeWindow` (getter) | `window.activePane` (getter) |
<!-- /port --><!-- port:go -->| Go | `session.ActiveWindow()` → `(Window, bool)` | `window.ActivePane()` → `(Pane, bool)` |
<!-- /port --><!-- port:rs -->| Rust | `await session.active_window()` → `Result<Option<Window>, Error>` | `await window.active_pane()` → `Result<Option<Pane>, Error>` |
<!-- /port --><!-- port:java -->| Java | `session.activeWindow()` → `Optional<Window>` | `window.activePane()` → `Optional<Pane>` |
<!-- /port --><!-- port:csharp -->| C# | `session.ActiveWindow` (property) | `window.ActivePane` (property) |
<!-- /port --><!-- port:cxx -->| C++ | `session->active_window()` | `window->active_pane()` |
<!-- /port --><!-- port:swift -->| Swift | filter for `isActive` on `snapshot.windows(of: session)`: `Window` carries its own `window_active` flag rather than the session exposing an accessor | same pattern, on the pane's own active flag |
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
the same server. Equality operators vary by port:

| Port | How you check |
|------|----------------|
<!-- port:py -->| Python | `window.window_id == other.window_id` (or `pane.pane_id == ...`) |
<!-- /port --><!-- port:ts -->| TypeScript | compare `.id` |
<!-- /port --><!-- port:go -->| Go | `pane.ID() == other.ID()`: `PaneID` is a plain, `==`-comparable `string` |
<!-- /port --><!-- port:rs -->| Rust | `pane.id() == other.id()`: verified from the port's own doctests, not struct equality |
<!-- /port --><!-- port:java -->| Java | `pane.equals(other)`: overridden to compare server identity plus pane ID |
<!-- /port --><!-- port:csharp -->| C# | `pane.Equals(other)`: overridden to compare a generation counter plus ID |
<!-- /port --><!-- port:cxx -->| C++ | `pane == other`: `operator==` is defined directly on `Session`/`Window`/`Pane` |
<!-- /port --><!-- port:swift -->| Swift | compare `.id` for identity; see the equality note below |
<!-- /port -->
<!-- port:swift -->
**Swift's equality compares captured state.** Compiler-synthesized equality for
`Session`, `Window`, and `Pane` compares every stored property, including
dimensions and current command. Two reads can compare unequal even when they
describe the same tmux object. Compare `.id` when checking identity on the same
server.
<!-- /port -->
