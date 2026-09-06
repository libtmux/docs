---
title: Server, session, window, pane
description: The object hierarchy every libtmux port mirrors from tmux itself, and the client that sits outside it.
sidebar:
  label: Server, session, window, pane
  group: Concepts
  order: 2
tableOfContents: true
---

libtmux models tmux's server, session, window, and pane objects:

```
Server
├── Session
│   └── Window
│       └── Pane
└── Client (attached view)
```

A `Server` contains sessions. Each `Session` contains links to windows, and each
`Window` contains panes. Commands run inside a `Pane`, where you send input and
capture output. A window can be linked to more than one session.

## Stable identity, not name or index

tmux assigns a unique ID to each session, window, and pane at creation. The ID
remains stable for that object's lifetime even if its name or index changes:

| Object | ID prefix | Example |
|--------|-----------|---------|
| Session | `$` | `$13` |
| Window | `@` | `@3243` |
| Pane | `%` | `%5433` |
| Server | - | identified by socket name or path instead |

Python handles use the object ID to refresh their fields. Immutable snapshots,
such as those in TypeScript, Swift, and Go, use IDs to identify the same tmux
object across reads.

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

A `Client` represents a terminal attached to a session. Several clients can view
the same server, and each can switch sessions or windows independently. Client
fields describe the view at the time of the read.

A [control-mode connection](../transports/) is also a client. It appears in
`list-clients`, counts toward `session_attached`, and affects
attachment-dependent behavior such as `destroy-unattached`. Closing the last
attached client can therefore destroy a session configured with that option.

## What differs between ports

Ports differ in how they read state and report failures:

- **Refreshing state.** Python objects reflect their last read until you call
  `.refresh()`. TypeScript, Swift, and Go also provide snapshots whose
  relationships can be queried without another tmux command.
- **Blocking and async calls.** Python and Java use blocking calls. Rust,
  TypeScript, .NET, and Swift provide async APIs. Go uses ordinary calls with
  contexts for cancellation and deadlines.
- **Failure handling.** Python and .NET raise exceptions. C++ returns
  `expected<T, CommandFailure>`. Some commands have an expected negative answer,
  such as `has-session` when a session is absent; check the method's result
  contract before treating that answer as a failure.

See [Control mode vs one-shot](../transports/) for command costs and connection
behavior.
