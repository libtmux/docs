---
title: Traversal
description: Moving up and down the server/session/window/pane tree, and the two questions that come up once you have more than one object.
sidebar:
  label: Traversal
  group: Topics
  order: 3
tableOfContents: true
---

[Server, session, window, pane](/concepts/server-session-window-pane/)
covers the shape of the tree and what it means for a handle to be
live-refreshing versus an immutable snapshot. This page is the practical
side of that: the actual calls that move you from one level to another in
each port, and the two questions that come up once you're holding more than
one object — is this one *in* that collection, and are these two handles
the *same* underlying tmux object.

## Down the hierarchy

Every port gives you a way to list a level's children. Whether that costs a
fresh tmux round trip or reads a snapshot already in memory is the sync/live
vs. async/snapshot split [Server, session, window,
pane](/concepts/server-session-window-pane/) already covers — the
table below is only the call shape:

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

TypeScript's `session.windows` and `window.panes` are plain getters, not
async calls: the one `await server.sessions()` reads the whole graph, and
everything you reach from an object it returned is answered out of that
already-loaded graph rather than a further tmux call — the same is true of
`window.panes` in the table above. Rust additionally has a narrower
`server.attached_sessions()`, scoped to sessions with a client attached —
a real, separate method from the unscoped `sessions()` in the table, not a
substitute for it.

## Up the hierarchy

The reverse direction — pane to window, window to session — is where ports
diverge on cost even when the *name* looks the same. Some answer from data
the handle already carries (no tmux call, ports where a snapshot loaded the
whole graph); others make a fresh call every time (matching a live-refreshing
handle's contract in general — see [Server, session, window,
pane](/concepts/server-session-window-pane/)):

| Port | Pane → window | Window → session |
|------|----------------|--------------------|
| Python | `pane.window` | `window.session` |
| TypeScript | `pane.window` (getter, from the loaded graph) | `window.session` (getter) |
| Go | `pane.Window()` → `(Window, bool)` | `window.Session()` → `(Session, bool)` |
| Rust | `await pane.window()` → `Result<Option<Window>, Error>` | `await window.session()` → `Result<Option<Session>, Error>` |
| Java | `pane.window()` | `window.session()` |
| .NET | `pane.Window` (property) | `window.Session` (property) |
| C++ | `pane->window()` | `window->session()` |
| Swift | `pane.windowID`, then look it up via `Snapshot` | not a per-window field — join through the snapshot instead |

Go's and Rust's `bool`/`Option` results exist because a pane or window can
outlive the parent it once had (the window was killed, the pane moved) —
both let you ask "does this relationship still hold" without an exception
for the ordinary case of a stale handle. .NET's `.Window` / `.Session`
properties are synchronous because they're read from the same snapshot the
handle was materialized with, the same reasoning as .NET's `.ActiveWindow` /
`.ActivePane` below — they throw `IncompleteSnapshotException` rather than
making a surprise tmux call if that handle wasn't captured with enough
context to answer.

## One walk, down and back up

The same round trip in each port: take the first session, walk down to a
window and a pane, then walk back up and check the object you land on is the
one you started from — using each port's own answer to "is this the same
object?" from the table below.

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
| Swift | filter for `isActive` on `snapshot.windows(of: session)` — `Window` carries its own `window_active` flag rather than the session exposing an accessor | same pattern, on the pane's own active flag |

Swift's shape here is the one genuinely different design: every other port
puts the "give me the active one" behavior on the *parent* (a method or
property on `Session`/`Window`); Swift puts an `isActive` boolean on the
*child* instead and leaves finding it to a snapshot filter. Both answer the
same question — [Format-token fields](../format-tokens/) covers the
equivalent field-level view (`window_active`, `pane_active`, and friends)
that every port's active-child *and* plain-listing paths ultimately read
from.

## Is it in that collection?

Checking membership generally goes through whatever your language uses for
collection membership, since most of these calls already return an ordinary
array, slice, or list:

- **Python** overloads `in` directly on its `QueryList`: `window in
  session.windows`, `pane in window.panes`.
- **Java**, **C++**, and **.NET** get back a plain `List`/`std::vector`/
  `IReadOnlyList` and use whatever that language's standard library offers
  for it (`.contains()`, a linear search) — a libtmux-specific membership
  method is not part of what's verified for any of them.
- **TypeScript**'s `session.windows` and similar are typed `Selection<T>`,
  not a plain array — it's iterable, but whether it exposes its own
  `.includes()`-shaped membership check wasn't verified for this page;
  spreading it into an array first (`[...session.windows]`) is the safe
  fallback either way.
- **Go** and **Rust** are the same, over a `[]Window` slice or `Vec<Window>`
  — Go has no built-in generic `Contains` for a slice at all; reach for
  `slices.Contains` (stdlib, Go 1.21+) or compare `.ID()` values yourself.

## Is this the same object?

Two handles can describe the same tmux window without being the same Python
object, the same Go value, or (per the trap below) comparing equal by
default — so "same underlying object" is answered by ID, and ports differ in
whether they've wired that into `==`/`.equals()` for you or leave it to you
to compare the ID field explicitly:

| Port | How you check |
|------|----------------|
| Python | `window.window_id == other.window_id` (or `pane.pane_id == ...`) |
| TypeScript | compare `.id` |
| Go | `pane.ID() == other.ID()` — `PaneID` is a plain, `==`-comparable `string` |
| Rust | `pane.id() == other.id()` — verified from the port's own doctests, not struct equality |
| Java | `pane.equals(other)` — overridden to compare server identity plus pane ID |
| .NET | `pane.Equals(other)` — overridden to compare a generation counter plus ID |
| C++ | `pane == other` — `operator==` is defined directly on `Session`/`Window`/`Pane` |
| Swift | compare `.id` explicitly — see the trap below |

**The Swift trap.** `Session`, `Window`, and `Pane` are plain
`Hashable`/`Codable` structs in Swift with no custom `==` or `hash(into:)`
of their own, which means Swift's compiler-synthesized equality compares
*every* stored property — width, height, the current command, all of it —
not just the ID. Two reads of what is genuinely the same tmux pane, taken a
moment apart, will compare `!=` the instant anything about that pane
changes, even though `pane1.id == pane2.id` is still true. Java, .NET, and
C++ deliberately override equality to mean identity; Swift does not, so
`==` there answers "identical snapshot," not "same object" — compare `.id`
when that's the question you mean to ask.
