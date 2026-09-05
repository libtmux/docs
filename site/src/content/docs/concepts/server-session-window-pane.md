---
title: Server, session, window, pane
description: The object hierarchy every libtmux port mirrors from tmux itself, and the client that sits outside it.
sidebar:
  label: Server, session, window, pane
  group: Concepts
  order: 2
tableOfContents: true
---

Every libtmux port works through the same four nouns, because they aren't a
design choice a port made — they're tmux's own hierarchy, and a port's object
model is a typed proxy over it:

```
Server
├── Session
│   └── Window
│       └── Pane
└── Client (attached view)
```

A `Server` owns sessions. A `Session` owns windows. A `Window` owns panes. A
`Pane` is where commands actually run — it's the thing you type into and
read output from. Whatever a port calls these (Python's `Server`/`Session`/
`Window`/`Pane`, C++'s value types of the same names, Go's `tmux.Session` and
`tmux.Window`), you are always navigating this same tree: a server's
sessions, a session's windows, a window's panes.

## Stable identity, not name or index

tmux assigns each session, window, and pane a unique ID the moment it's
created, and every port tracks objects by that ID rather than by name or
position — names get renamed, indexes shift when a window in front of yours
closes, but the ID is stable for the object's lifetime:

| Object | ID prefix | Example |
|--------|-----------|---------|
| Session | `$` | `$13` |
| Window | `@` | `@3243` |
| Pane | `%` | `%5433` |
| Server | — | identified by socket name or path instead |

Ports that hand you a live-refreshing handle (Python's `Session.refresh()`)
use the ID to re-fetch the same object tmux still recognizes; ports that hand
you an immutable snapshot (TypeScript's `Selection`, Swift's `Snapshot`,
Go's "records never refresh behind you" values) use the ID to compare two
snapshots and confirm they're talking about the same underlying object across
reads.

Walking the whole tree, in each port:

```python
for session in server.sessions:
    print(session.session_name)
    for window in session.windows:
        print(" ", window.window_index, window.window_name)
        for pane in window.panes:
            print("   ", pane.pane_id, pane.pane_current_command)
```

```typescript
for (const session of await server.sessions()) {
  console.log(session.name);
  for (const window of session.windows) {
    console.log(" ", window.index, window.name);
    for (const pane of window.panes) {
      console.log("   ", pane.id, pane.currentCommand);
    }
  }
}
```

```rust
// Three tmux commands total, not one per object: walking down would cost a
// command per session and per window.
for branch in server.hierarchy().await? {
    let session = &branch.session;
    println!("{session} {} ({} windows)",
        session.name().to_string_lossy(), session.window_count());

    for built in &branch.windows {
        let window = &built.window;
        println!("  {window} {}", window.name().to_string_lossy());

        for pane in &built.panes {
            println!("    {pane}");
        }
    }
}
```

```go
// A snapshot reads sessions, windows, and panes in one pass; relations
// resolve against it without another tmux command.
snapshot, err := server.Snapshot(ctx)
for _, session := range snapshot.Sessions() {
	name, _ := session.Name()
	fmt.Printf("%s %q\n", session.ID(), name)

	windows, _ := session.Windows()
	for _, window := range windows {
		fmt.Printf("  %s:%d\n", window.ID(), window.Index())
		panes, _ := window.Panes()
		for _, pane := range panes {
			command, _ := pane.CurrentCommand()
			fmt.Printf("    %s %q\n", pane.ID(), command)
		}
	}
}
```

```java
for (Session session : server.sessions()) {
    System.out.println(session.name());
    for (Window window : session.windows()) {
        System.out.println("  " + window.index() + " " + window.name());
        for (Pane pane : window.panes()) {
            System.out.println("    " + pane.id().value() + " " + pane.currentCommand());
        }
    }
}
```

```csharp
foreach (Session session in await server.GetSessionsAsync())
{
    Console.WriteLine(session.Name);
    foreach (Window window in await session.GetWindowsAsync())
    {
        Console.WriteLine($"  {window.Index} {window.Name}");
        foreach (Pane pane in await window.GetPanesAsync())
        {
            Console.WriteLine($"    {pane.Index} {pane.Width}x{pane.Height}");
        }
    }
}
```

```cpp
const auto sessions = server.sessions();
if (!sessions.has_value()) return 1;

for (const libtmux::Session& session : *sessions) {
  std::printf("%s (%lld windows)\n", std::string{session.name()}.c_str(),
              session.window_count());

  const auto windows = session.windows();
  if (!windows.has_value()) continue;

  for (const libtmux::Window& window : *windows) {
    std::printf("  %s\n", std::string{window.name()}.c_str());

    const auto panes = window.panes();
    if (!panes.has_value()) continue;

    for (const libtmux::Pane& pane : *panes) {
      std::printf("    %s\n", std::string{pane.id()}.c_str());
    }
  }
}
```

```swift
// A snapshot reads sessions, windows, and panes in one pass; the relations
// below resolve against it without another tmux command.
let snapshot = try await server.snapshot()
for session in snapshot.sessions {
    print(session.name)
    for window in snapshot.windows(of: session) {
        print(" ", window.name)
        for pane in snapshot.panes(of: window) {
            print("   ", pane.id, pane.currentCommand)
        }
    }
}
```

## Client: a view, not a child

`Client` is the one thing in the diagram that isn't a child of anything.
Where a `Session` owns its `Window`s and a `Window` owns its `Pane`s, a
`Client` is an attached terminal that *points at* whichever session, window,
and pane it's currently viewing — one `$ tmux attach` from a person's
terminal. The same server can host several clients at once, each looking at
something different, and a client's view can change the instant that person
runs `switch-client` or `select-window`. That's why a client's session/
window/pane fields are a snapshot of where it was pointed when you read it,
not a live relationship you can walk the way you walk from a pane up to its
window.

This distinction matters for one very concrete reason across every port: a
control-mode connection (see
[Control mode vs one-shot](../transports/)) *is* a client. Opening one
adds a row to `list-clients`, counts toward `session_attached`, and is
visible to anything that keys off attachment — including policies like
`destroy-unattached`, which will tear down a session the moment your
program's control client detaches from it.

## What differs between ports

The hierarchy above is fixed. What ports disagree on, on purpose, is:

- **Whether a held object refreshes.** Python's objects re-read from tmux
  when you call `.refresh()`, but otherwise reflect the state at construction.
  TypeScript, Swift, and Go's Rust-flavored "read once into an immutable
  snapshot, then query it like data" model goes further: the whole server is
  read in one pass, and every relationship you walk after that touches no
  further tmux state at all.
- **Sync vs async.** Python and Java block on every call, matching tmux's own
  subprocess model directly. Rust, Go, TypeScript, C#, and Swift make every
  tmux round trip an explicit `async`/`await`, because the underlying work —
  starting a process or reading a socket — is I/O.
- **How failure surfaces.** Some ports raise (Python's `LibTmuxException`
  hierarchy, C#'s exceptions); C++ returns `expected<T, CommandFailure>` and
  never throws for a tmux-side failure; a few treat a nonzero-exit tmux
  command as data rather than an error, because (as C++'s docs put it)
  `has-session` answering "no" is a reply, not a failure.

None of that changes the shape in the diagram above. It changes what it
costs you to read from it, and how you find out when something went wrong.
