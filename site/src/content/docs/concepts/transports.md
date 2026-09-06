---
title: Control mode vs one-shot
description: How a call in your program actually reaches the tmux server, and why a port might give you a choice.
sidebar:
  label: Control mode vs one-shot
  group: Concepts
  order: 3
tableOfContents: true
---

libtmux sends commands to tmux through subprocesses or persistent control-mode
connections. Some ports also batch commands into one invocation:

1. **One-shot subprocess.** Each command spawns a fresh `tmux` process,
   which parses argv, executes the command, prints its output, and exits. This is
   the default in every port, and the *only* lane in Python: every `.cmd()`
   call underneath the object API is a `subprocess.Popen` around a `tmux`
   invocation.
2. **A persistent control-mode client.** `tmux -C attach-session` starts one
   long-lived tmux process that stays attached and speaks a line-oriented
   protocol over its stdout: commands go in, replies and asynchronous
   notifications (`%window-add`, `%output`, ...) come out, without starting a
   process per call.
3. **One invocation, several commands.** tmux accepts more than one command
   per invocation (`;`-joined, or one `-F`-tagged `list-*` per line). A port
   can fold several logical operations into a single process start without
   opening a control-mode connection at all.

## Where each port draws the line

| Port | One-shot | Folded invocation | Persistent control client |
|------|----------|--------------------|-----------------------------|
| Python | every call | - | test-only (`ControlMode`, `libtmux._internal`) |
| TypeScript | default | `pipeline()`, `batch()` | `connect()` / `watch()`: notifications only, commands stay per-process |
| Go | `process` path | `plan` / `Run` | `connection` (`Session.OpenControl`), `streaming` (`OpenNotifications`) |
| Rust | `plan` feature, sequential | `plan`, folded | `control-mode` feature |
| C# | "One-shot" mode | "Chained" mode (`server.Chain()`) | "Control" mode (`EnterControlModeAsync`) |
| C++ | bounded subprocess (default) | `Chain` | `Server::control()` → `Connection` |
| Java | every call | `Batch` | `ControlClient` (`attach`, `send`, `subscribeEvents`) |
| Swift | default | - | `server.connect()` / `.watch()` (notifications; see below) |

Choose based on whether you need command results, notifications, or a batch of
changes.

## Notifications and commands are separable

TypeScript's `connect()` adds an event observer while commands such as
`session.newWindow(...)` and `pane.sendKeys(...)` continue to run as separate
tmux processes. A dedicated process provides a completion boundary for output
from alias-expanded or waiting commands.

Go's `Session.OpenControl`, .NET's `EnterControlModeAsync`, Java's
`ControlClient.send`, and Rust's `control-mode` feature can send commands
through the persistent connection.
Check your port's transport API before assuming that subscribing to events also
changes how commands run.

## A control client is a real client

A persistent control connection attaches a tmux client. It appears in
`list-clients`, increments `session_attached`, and affects `destroy-unattached`,
client hooks, and idle-client accounting. Each connection counts separately.
Python's internal `ControlMode` test helper uses this behavior for commands that
require an attached client, such as `display-popup` and `detach-client`.

## Why fold several commands into one invocation

Creating an object can require a second command to read its resulting state.
Batching reduces those repeated reads and process starts. TypeScript's `batch()`
resolves planned mutations from one final snapshot. Go's `Plan`, .NET's `Chain`,
and C++'s `Chain` also group operations without attaching a control client.

## What this costs in practice

The Rust `matrix` example and .NET README compare process counts and timings.
Their results describe specific workloads and environments:

- **Rust's** `matrix` example runs the same create-and-query workload five
  ways. Blocking sequential and async sequential both cost 6 processes for 6
  dispatches; folding the same 6 into async batches costs 3 processes;
  routing them over a control-mode connection costs exactly 1.
- **C#'s** README reports the *marginal* cost of one more command in each
  mode, as medians against tmux 3.7b: roughly 2.3 ms for another one-shot
  process, roughly 0.2 ms for another command over an already-open control
  client, and roughly 0.02 ms for another command folded into one chained
  invocation.

A persistent connection avoids starting a client for each command. A chain
groups a known sequence into one invocation. For occasional commands, use the
default subprocess transport; measure your workload before changing transports
for performance. Use a notification stream when your program needs tmux events.

## Choosing a lane

These examples use each port's subprocess API. See the port reference for
batching and control-mode setup.

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
ctx := context.Background()

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
pane, _, err := window.ResolveActivePane(ctx)
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
