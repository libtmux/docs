---
title: Getting started
description: Install tmux, pick a port, and run the smallest thing that proves your setup works.
sidebar:
  label: Getting started
  group: Guides
  order: 2
tableOfContents: true
---

## Install tmux

Every port's floor is tmux 3.2a — it's the oldest release all eight are
tested against, so anything from there through whatever your package manager
ships today will work. Confirm what you have:

```console
$ tmux -V
```

If that prints something older than `tmux 3.2a`, or `tmux` isn't found at
all, install a current one through your platform's package manager before
going further — how to do that is outside libtmux's scope, since libtmux
drives an existing tmux rather than bundling one.

## Pick a port

All eight ports drive the same tmux the same way underneath — the choice is
your project's language, not a difference in what's possible. Use the port
switcher at the top of any page, or jump straight to a landing page:
[Python](/py/), [TypeScript](/ts/), [Rust](/rs/), [Go](/go/),
[Java and Kotlin](/java/), [.NET](/dotnet/), [C++](/cxx/),
[Swift](/swift/). If you're not sure yet,
[Server, session, window, pane](/concepts/server-session-window-pane/) and
[Control mode vs one-shot](/concepts/transports/) cover what's shared and
what's worth knowing before you commit.

Every port carries an `-alpha` prerelease tag today except Python, which is
the long-established original the others are ports *of* — pin an exact
version everywhere else, and expect the newer ports' APIs to still move.

## Run the smallest thing that proves it works

Start a tmux session to connect to — in one terminal:

```console
$ tmux new-session -s foo -n bar
```

In a second terminal, install your port's package and run the round trip
below: connect, get a pane, send it a command, and read back what printed.
Python's block attaches to the `foo` session above; the rest create their
own instead, so `foo` is never touched by anything but Python's — either
way you'll see the same round trip happen. The install command is repeated
as a comment on the first line of each block — it isn't part of the source
being quoted, just this page naming it next to the code. Python's block is
a live doctest, run against a real, isolated tmux session on every run of
the test suite (`README.md` and `src/libtmux` are `pytest`'s `testpaths`,
see `pyproject.toml`); every other block here is the same source
[Attach and send keys](/examples/attach-and-send-keys/) quotes in full, or a
shorter cut of it — see that page for exactly how each is checked, for the
full version of any block trimmed here, and for the rest of that round trip.

```python
# pip install libtmux
>>> import libtmux
>>> server = libtmux.Server()
>>> session = server.sessions[0]
>>> window = session.active_window
>>> pane = window.split(shell='sh')
>>> pane.capture_pane()
['$']

>>> pane.send_keys('echo "Hello world"', enter=True)

>>> pane.capture_pane()
['$ echo "Hello world"', 'Hello world', '$']
```

```typescript
// bun add libtmux
import { Server } from "libtmux";

const server = new Server();
const session = await server.newSession({ name: "work" });
const editor = await session.newWindow({ name: "editor" });
await editor.split();

await editor.panes.at(0)?.sendKeys("echo hello");
const lines = await editor.panes.at(0)?.capture();
```

```go
// go get github.com/libtmux/libtmux-go
session, err := server.NewSession(ctx, tmux.NewSessionRequest{
	Name: "libtmux-go-quickstart", WindowName: "start",
})
if err != nil {
	return fmt.Errorf("create session: %w", err)
}

windowName := "work"
window, err := session.NewWindow(ctx, tmux.NewWindowRequest{Name: &windowName})
if err != nil {
	return fmt.Errorf("create window: %w", err)
}
pane, err := window.SplitPane(ctx, tmux.SplitPaneRequest{
	Direction: tmux.PaneDirectionRight,
})
if err != nil {
	return fmt.Errorf("split window: %w", err)
}
command := "printf 'libtmux ready\\n'"
if err := pane.SendKeys(ctx, tmux.SendKeysRequest{Command: &command, Literal: true}); err != nil {
	return fmt.Errorf("send command: %w", err)
}
```

```rust
// cargo add libtmux
use libtmux::Server;

// TestServer is the isolated, disposable form of this used under `test-support`
// for the port's own tests (see Testing with libtmux) — real code just calls
// Server::new() directly, as below.
let server = Server::new()?;
let session = server.new_session("work").await?;
let window = session.new_window("editor").await?;
let pane = window.active_pane().await?.expect("a window has a pane");

pane.send_line("echo hello").await?;

for line in pane.capture().await? {
    println!("{}", line.to_string_lossy());
}
```

```java
// implementation("io.github.libtmux:libtmux:VERSION")
Session session = server.newSession("demo");
Window editor = session.newWindow("editor");
Pane right = editor.split();

session.name();                      // → demo
editor.name();                       // → editor
editor.refresh().panes().size();     // → 2

Pane pane = server.sessions().get(0).windows().get(0).panes().get(0);

pane.sendLine("echo hello from libtmux");

pane.capture().isEmpty();            // → false
```

```csharp
// dotnet add package LibTmux
using LibTmux;

Server server = await Server.ConnectAsync();
Session session = await server.CreateSessionAsync(new NewSessionRequest(name: "build"));
Window window = await session.CreateWindowAsync(new NewWindowRequest(name: "tests"));
Pane pane = (await window.GetPanesAsync())[0];

await pane.SendTextAsync("dotnet test");
```

```cpp
// vcpkg install libtmux-cxx
const auto sessions = server.sessions();
// sessions->at(0) is this example's session, from an already-open scratch server.
const libtmux::Session& session = sessions->at(0);

// Build an arrangement without composing a single tmux argument.
const auto editor = session.new_window({.name = "editor"});
const auto logs = editor->split({.horizontal = true, .percentage = 30});

(void)logs->send_text("journalctl -f");
(void)logs->send_key("Enter");

// Read a pane's visible contents, or its scrollback.
const auto visible = logs->capture();
```

```swift
// .package(url: "https://github.com/libtmux/libtmux-swift", from: "0.1.0")
let session = try await server.newSession(named: "work", windowName: "editor")
let logs = try await server.newWindow(in: session, named: "logs").window
let pane = try await server.splitWindow(logs, direction: .right)
try await server.run("tail -f /tmp/build.log", in: pane)

let lines = try await server.capture(pane)
```

## What just happened

Connecting reaches the tmux server already running on the machine (or starts
one) — nothing above draws a terminal of its own. Sending a command types it
into the pane as if at a keyboard and, where the call takes one, an `enter`
or `literal` argument decides whether it also presses Enter and whether tmux
may read the text as one of its own key names instead of characters — see
[Sending keys](../sending-keys/) for exactly how each port draws that line.
Capturing reads the pane's visible screen back as a list of lines, top to
bottom. That round trip — get a pane, send it something, read back what
happened — is the shape nearly everything else in this documentation builds
on.

## Where to go next

- [Concepts](/concepts/) for the mental model behind what you just did —
  the object hierarchy, how commands actually reach tmux, and how filtering
  works once you have more than one session to choose from.
- [Attaching to tmux](../attaching-to-tmux/), [Sending keys](../sending-keys/),
  and [Capturing output](../capturing-output/) go one level deeper into each
  half of the round trip you just ran.
- [Attach and send keys](/examples/attach-and-send-keys/) for the fully
  checked version of every block above, and how each one is verified.
- Your port's own API reference (via the port switcher) once you're ready
  to build something real.
