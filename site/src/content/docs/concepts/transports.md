---
title: Control mode vs one-shot
description: How a call in your program actually reaches the tmux server, and why a port might give you a choice.
sidebar:
  label: Control mode vs one-shot
  group: Concepts
  order: 3
tableOfContents: true
---

`pane.send_keys("...")` looks like one call in every port. What happens
underneath it — and what it costs — is not the same thing twice. Three
distinct lanes show up, in some combination, across the eight ports:

1. **One-shot subprocess.** Each command spawns a fresh `tmux` process,
   which parses argv, does the thing, prints its output, and exits. This is
   the default in every port, and the *only* lane in Python: every `.cmd()`
   call underneath the object API is a `subprocess.Popen` around a `tmux`
   invocation.
2. **A persistent control-mode client.** `tmux -C attach-session` starts one
   long-lived tmux process that stays attached and speaks a line-oriented
   protocol over its stdout — commands go in, replies and asynchronous
   notifications (`%window-add`, `%output`, ...) come out, without starting a
   process per call.
3. **One invocation, several commands.** tmux accepts more than one command
   per invocation (`;`-joined, or one `-F`-tagged `list-*` per line). A port
   can fold several logical operations into a single process start without
   opening a control-mode connection at all.

## Where each port draws the line

| Port | One-shot | Folded invocation | Persistent control client |
|------|----------|--------------------|-----------------------------|
| Python | every call | — | test-only (`ControlMode`, `libtmux._internal`) |
| TypeScript | default | `pipeline()`, `batch()` | `connect()` / `watch()` — notifications only, commands stay per-process |
| Go | `process` path | `plan` / `Run` | `connection` (`Session.OpenControl`), `streaming` (`OpenNotifications`) |
| Rust | `plan` feature, sequential | `plan`, folded | `control-mode` feature |
| C# | "One-shot" mode | "Chained" mode (`server.Chain()`) | "Control" mode (`EnterControlModeAsync`) |
| C++ | bounded subprocess (default) | `Chain` | `Server::control()` → `Connection` |
| Java | every call | — | not documented here — see the port's own reference |
| Swift | default | — | `server.connect()` / `.watch()` (notifications; see below) |

Two things are worth noticing in that table before you pick a lane.

## Notifications and commands are separable

The most easily-missed distinction, and TypeScript states it most directly:
**a control-mode connection for reading tmux's event stream is not the same
decision as running your commands through it.** TypeScript's `connect()`
returns the same handles as an ordinary server and *adds* an event observer;
your commands — `session.newWindow(...)`, `pane.sendKeys(...)` — still run as
separate tmux processes even while connected. The reason given is blunt:
control mode cannot delimit arbitrary alias-expanded or waiting command
output truthfully, so commands that need trustworthy output keep using their
own process.

Go and C# instead let a control-mode *connection* carry commands directly
(`Session.OpenControl`, `EnterControlModeAsync`) as a genuine alternative to
one-shot for repeated work — Go's own comparison table calls it "one tmux
client per lane" against "one tmux process per operation." Rust's
`control-mode` feature does the same for its async engine. So "does control
mode run my commands, or only tell me what changed?" is a real per-port
question, not a detail — check the port's own docs before assuming either
answer.

## A control client is a real client

Every port that offers a persistent connection says a version of the same
thing: opening one **attaches a real tmux client**. It shows up in
`list-clients`, it increments `session_attached`, and it is visible to
anything that keys off attachment — a `destroy-unattached` option, a client
hook, tmux's own idle-client accounting. Python's `ControlMode` helper exists
*specifically* to satisfy commands that require a real attached client in
tests (`display-popup`, `detach-client`); it is `libtmux._internal`, not part
of the public API, precisely because the rest of the library never needs one.
Opening several connections at once (TypeScript's `watch()` called twice,
say) creates several such clients, each counted separately.

## Why fold several commands into one invocation

Every mutation you make against a fresh session usually needs a second
command right after it — read back the ID tmux assigned, list what now
exists — so "create three windows" is naturally six processes: three to
create, three to discover what was created. Folding removes half of that.
TypeScript's `batch()` runs several planned mutations and resolves every
typed handle from *one* final snapshot; Go's `Plan` and C#'s `Chain` do the
version of the same idea specific to their APIs; C++'s `Chain` builds one
argv carrying several commands. None of this needs an attached client —
it's still one `tmux` process, just given more to do per start.

## What this costs in practice

Two ports publish numbers, and they agree on the *shape* even though the
absolute values are machine- and tmux-version-specific and not something to
port to your own hardware:

- **Rust's** `matrix` example runs the same create-and-query workload five
  ways. Blocking sequential and async sequential both cost 6 processes for 6
  dispatches; folding the same 6 into async batches costs 3 processes;
  routing them over a control-mode connection costs exactly 1.
- **C#'s** README reports the *marginal* cost of one more command in each
  mode, as medians against tmux 3.7b: roughly 2.3 ms for another one-shot
  process, roughly 0.2 ms for another command over an already-open control
  client, and roughly 0.02 ms for another command folded into one chained
  invocation.

Read the crossover, not the digits: a control connection is cheaper per
command because its client is already running, while a chain wins for a
one-off batch because it pays exactly one round trip for the whole sequence
and needs no attached client at all. For a handful of commands run once,
one-shot is simplest and the difference doesn't matter. Once you're issuing
tens of commands in a loop, or you need tmux's own notifications rather than
polling `capture_pane` on a timer, that's the point to reach for whichever
of the other two lanes your port offers.

## Choosing a lane

Every port defaults to one-shot, so the code you write first is the code
below. Where a port offers control mode, it is opt-in at the point the server
handle is constructed — the object API above it does not change.

```python
import libtmux

# One-shot: every call underneath this handle spawns a `tmux` process.
server = libtmux.Server()
session = server.new_session(session_name="work")
session.active_window.active_pane.send_keys("echo hello")
```

```typescript
import { Server } from "libtmux";

// The TypeScript port drives a persistent transport under the same object
// API, so the await points are where the process boundary used to be.
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

Watch the cost directly — one process per command is visible from outside:

```console
$ tmux -C attach-session -t work
```
