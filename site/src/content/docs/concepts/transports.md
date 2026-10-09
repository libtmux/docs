---
supportedPorts: [py, ts, go, java, csharp, cxx, swift]
title: Control mode vs one-shot
description: How a call in your program actually reaches the tmux server, and why a port might give you a choice.
sidebar:
  label: Control mode vs one-shot
  group: Concepts
  order: 3
tableOfContents: true
---

libtmux sends commands to tmux through subprocesses or persistent control-mode
connections. tmux also accepts several commands in one invocation:

1. **One-shot subprocess.** Each command spawns a fresh `tmux` process,
   which sends the request to the server, prints the result, and exits.
2. **A persistent control-mode client.** `tmux -C attach-session` starts one
   long-lived tmux process that stays attached and speaks a line-oriented
   protocol over its stdout: commands go in, replies and asynchronous
   notifications (`%window-add`, `%output`, ...) come out, without starting a
   process per call.
3. **One invocation, several commands.** tmux accepts more than one command
   per invocation (`;`-joined, or one `-F`-tagged `list-*` per line). A port
   can fold several logical operations into a single process start without
   opening a control-mode connection at all.

<a id="where-each-port-draws-the-line"></a>

## Available transports

| Port | One-shot | Folded invocation | Persistent control client |
|------|----------|--------------------|-----------------------------|
<!-- port:py -->| Python | every call | - | test-only (`ControlMode`, `libtmux._internal`) |
<!-- /port --><!-- port:ts -->| TypeScript | default | `pipeline()`, `batch()` | `connect()` / `watch()`: notifications only, commands stay per-process |
<!-- /port --><!-- port:go -->| Go | `process` path | `Plan.Run` | `connection` (`Session.OpenControl`), `streaming` (`Session.OpenNotifications`) |
<!-- /port --><!-- port:rs -->| Rust | default | `CommandChain` or `plan` | `control-mode` feature |
<!-- /port --><!-- port:csharp -->| C# | "One-shot" mode | "Chained" mode (`server.Chain()`) | "Control" mode (`EnterControlModeAsync`) |
<!-- /port --><!-- port:cxx -->| C++ | bounded subprocess (default) | `Chain` | `Server::control()` → `Connection` |
<!-- /port --><!-- port:java -->| Java | every call | `Batch` | `ControlClient` (`attach`, `send`, `subscribeEvents`) |
<!-- /port --><!-- port:swift -->| Swift | default | - | `Server.connected(attachingTo:_:)` / `ControlConnection.watch(_:)` |
<!-- /port -->

Choose based on whether you need command results, notifications, or a batch of
changes.

<!-- port:ts,go,csharp,java,rs -->
## Notifications and commands are separable

<!-- port:ts -->
TypeScript's `connect()` adds an event observer while commands such as
`session.newWindow(...)` and `pane.sendKeys(...)` continue to run as separate
tmux processes. A dedicated process provides a completion boundary for output
from alias-expanded or waiting commands.
<!-- /port -->



<!-- port:go -->
`Session.OpenControl` opens a persistent command connection. `Session.OpenNotifications`
opens a notification stream. Close each handle when finished. Starting an
observer does not change the transport used by an existing server handle.
<!-- /port -->
<!-- port:csharp -->
Use `EnterControlModeAsync` for commands on a persistent connection.
<!-- /port -->
<!-- port:java -->
`ControlClient.send` sends commands through the persistent connection.
<!-- /port -->
<!-- port:rs -->
Enable the `control-mode` feature to send commands through a persistent
connection.
<!-- /port -->

<!-- /port -->

## A control client is a real client

A persistent control connection attaches a tmux client. It appears in
`list-clients`, increments `session_attached`, and affects `destroy-unattached`,
client hooks, and idle-client accounting. Each connection counts separately.
<!-- port:py -->
Python's internal `ControlMode` test helper uses this behavior for commands that
require an attached client, such as `display-popup` and `detach-client`.
<!-- /port -->



## Why fold several commands into one invocation

Creating an object can require a second command to read its resulting state.
Batching can reduce repeated reads and process starts.

<!-- port:ts -->
`batch()` resolves planned mutations from one final snapshot.
<!-- /port -->
<!-- port:go -->
A `Plan` groups operations without attaching a control client.
<!-- /port -->
<!-- port:csharp,cxx -->
A `Chain` groups operations without attaching a control client.
<!-- /port -->

<a id="choosing-a-lane"></a>

## What this costs in practice

A persistent connection avoids starting a client for each command. A chain
groups a known sequence into one invocation. For occasional commands, use the
default subprocess transport; measure your workload before changing transports
for performance. Use a notification stream when your program needs tmux events.

## Sending a command

The example uses the subprocess API. See the reference for batching and
control-mode setup.

```python
import libtmux

# One-shot: every call underneath this handle spawns a `tmux` process.
server = libtmux.Server()
session = server.new_session(session_name="work")
session.active_window.active_pane.send_keys("echo hello")
```

```typescript
import { Server } from "libtmux";

// Each awaited command uses a tmux subprocess.
const server = new Server();
const session = await server.newSession({ name: "work" });
const editor = await session.newWindow({ name: "editor" });
await editor.panes.at(0)?.sendKeys("echo hello");
```

```rust
use libtmux::Server;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // One-shot: every call underneath this handle spawns a `tmux` process.
    let server = Server::new()?;
    let session = server.new_session("work").await?;
    let window = session.active_window().await?.expect("a session has a window");
    let pane = window.active_pane().await?.expect("a window has a pane");
    pane.send_line("echo hello").await?;
    Ok(())
}
```

```go
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()

// One-shot: every call underneath this handle spawns a `tmux` process.
server, err := tmux.NewServer(tmux.ServerOptions{})
if err != nil {
	return err
}
session, err := server.NewSession(ctx, tmux.NewSessionRequest{Name: "work"})
if err != nil {
	return err
}
window, err := session.ResolveActiveWindow(ctx)
if err != nil {
	return err
}
pane, err := window.ResolveActivePane(ctx)
if err != nil {
	return err
}
command := "echo hello"
return pane.SendKeys(ctx, tmux.SendKeysRequest{Command: &command, Literal: true})
```

```java
ServerConfig config = ServerConfig.builder()
        .endpoint(ServerEndpoint.defaultSocket())
        .build();

// One-shot: every call underneath this handle spawns a `tmux` process.
try (Server server = Server.open(config)) {
    Session session = server.newSession("work");
    Pane pane = session.windows().get(0).panes().get(0);
    pane.sendLine("echo hello");
}
```

```csharp
using LibTmux;

// One-shot: every call underneath this handle spawns a `tmux` process.
Server server = await Server.ConnectAsync();
Session session = await server.CreateSessionAsync(new NewSessionRequest(name: "work"));
Window window = (await session.GetWindowsAsync())[0];
Pane pane = (await window.GetPanesAsync())[0];

await pane.SendTextAsync("echo hello");
```

```cpp
#include <libtmux/libtmux.hpp>

// One-shot: every call answers with a value; no tmux failure is thrown.
const auto server = libtmux::Server::at_default();
if (!server.has_value()) {
  return 1;
}

const auto session = server->new_session("work");
if (!session.has_value()) {
  return 1;
}

const auto pane = session->active_pane();
if (pane.has_value()) {
  (void)pane->send_text("echo hello");
  (void)pane->send_key("Enter");
}
```

```swift
import LibTmux

// One-shot: every call underneath this handle spawns a `tmux` process.
let server = try Server(socketName: "default")
let session = try await server.newSession(named: "work", windowName: "editor")
let window = try await server.newWindow(in: session, named: "logs").window
let pane = try await server.splitWindow(window, direction: .right)
try await server.run("echo hello", in: pane)
```

To inspect tmux's control protocol, attach a control client:

```console
$ tmux -C attach-session -t work
```
