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

The common tmux baseline documented here is 3.2a. Individual features can
require a newer release; check your port's compatibility notes. Confirm your
installed version:

```console
$ tmux -V
```

If `tmux` is missing or older than 3.2a, install a supported version with your
platform's package manager. libtmux uses an installed tmux executable.

## Pick a port

Choose the port for your project's language: [Python](/py/), [TypeScript](/ts/),
[Rust](/rs/), [Go](/go/), [Java and Kotlin](/java/), [.NET](/dotnet/),
[C++](/cxx/), or [Swift](/swift/). [Server, session, window,
pane](/concepts/server-session-window-pane/) explains the shared model, and
[Control mode vs one-shot](/concepts/transports/) covers transport differences.

For a prerelease package, pin an exact version and check its release notes
before upgrading. API availability and defaults can differ between ports.

## Run the smallest thing that proves it works

Start a tmux session to connect to: in one terminal:

```console
$ tmux new-session -s foo -n bar
```

In a second terminal, install your port's package and run its example. The
Python example uses the `foo` session above; the other examples create their own
sessions. Installation commands appear in comments at the start of each block.
[Attach and send keys](/examples/attach-and-send-keys/) provides the full
examples, their source files, and their validation details.

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
// for the port's own tests (see Testing with libtmux): real code just calls
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

A server handle targets tmux without taking over your terminal. Creating a
session starts the server if needed. Sending keys writes input to a pane; the
method's Enter and literal-text options control how tmux interprets it. [Sending
keys](../sending-keys/) explains those defaults. Capture methods read the pane's
screen or a requested scrollback range.

## Where to go next

- [Concepts](/concepts/) for the mental model behind what you just did:
  the object hierarchy, how commands actually reach tmux, and how filtering
  works once you have more than one session to choose from.
- [Attaching to tmux](../attaching-to-tmux/), [Sending keys](../sending-keys/),
  and [Capturing output](../capturing-output/) go one level deeper into each
  half of the round trip you just ran.
- [Attach and send keys](/examples/attach-and-send-keys/) for the fully
  checked version of every block above, and how each one is verified.
- Your port's own API reference (via the port switcher) once you're ready
  to look up method details.
