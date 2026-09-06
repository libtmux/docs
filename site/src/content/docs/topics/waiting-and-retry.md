---
title: Waiting and retrying
description: Polling a condition instead of guessing a sleep, and tmux's own wait-for signal channel as the alternative to polling.
sidebar:
  label: Waiting and retrying
  group: Topics
  order: 8
tableOfContents: true
---

After sending input or starting a process, wait for the state your next step
requires. [Pane
interaction](../pane-interaction/#waiting-for-something-to-finish) covers
waiting for screen text. This page covers arbitrary conditions and tmux's named
`wait-for` signal channels.

## Polling a condition

Polling checks a condition repeatedly until it succeeds or a deadline expires.
The helpers below expose an interval and timeout; several live in test-support
packages:

### Python

**Helper:** `libtmux.test.retry_until(fn, seconds=, interval=)`

**Where it lives:** The `libtmux.test` module in the main package; raises
`WaitTimeout`.

### TypeScript

**Helper:** `connectedServer.waitFor(matches, options)`

**Where it lives:** The public control-connection API. Tests a predicate over
`ServerSnapshot`; see [Control mode vs one-shot](/concepts/transports/).

### Go

**Helper:** `tmuxtest.WaitFor(ctx, interval, condition)`

**Where it lives:** `tmuxtest`, a separate test-support package from `tmux`

### Rust

**Helper:** `libtmux::test::retry_until(within, condition)`

**Where it lives:** `libtmux::test`, enabled with the `test-support` Cargo
feature.

### Java

**Helper:** Not listed.

**Where it lives:** not found in the shipped library; a package-private
`Await.until(...)` exists only inside the `integration-tests` module, which
downstream code cannot depend on

### .NET

**Helper:** `LibTmux.Testing.TmuxWait.UntilAsync(probe, timeout, interval)`

**Where it lives:** `LibTmux.Testing`, part of the same shipped `LibTmux`
package

### C++

**Helper:** Not listed.

**Where it lives:** no generic condition-poll helper found in the public
library; a `wait_until` exists only in the private `testing` component, for
waiting on a spawned child process, not on tmux state

### Swift

**Helper:** Not listed.

**Where it lives:** a `waitUntil` helper exists only inside the test target's
own support code, not shipped

### Examples

Python, Rust, Go, and .NET provide general polling helpers in their test-support
APIs. TypeScript's public `waitFor` instead waits on a server-snapshot predicate
through a control connection. It subscribes before reading so it does not miss a
change between those steps.

```python
def is_window_up(pane, name):
    return any(w.window_name == name for w in pane.window.session.windows)

libtmux.test.retry_until(lambda: is_window_up(pane, "build"), seconds=5.0)
```

```typescript
const live = await server.connect();
await live.waitFor((snapshot) => snapshot.windows.exists({ name: "build" }));
```

```go
err := tmuxtest.WaitFor(ctx, 50*time.Millisecond, func(ctx context.Context) (bool, error) {
	windows, err := session.Windows()
	if err != nil {
		return false, err
	}
	for _, w := range windows {
		if name, ok := w.Name(); ok && name == "build" {
			return true, nil
		}
	}
	return false, nil
})
```

```rust
libtmux::test::retry_until(std::time::Duration::from_secs(5), async || {
    session.windows().await.map(|ws| ws.iter().any(|w| w.name() == "build")).unwrap_or(false)
})
.await?;
```

```csharp
await LibTmux.Testing.TmuxWait.UntilAsync(
    async ct => (await session.GetWindowsAsync(ct)).Any(w => w.Name == "build"),
    TimeSpan.FromSeconds(5),
    TimeSpan.FromMilliseconds(50));
```

For Java, C++, and Swift, this page lists no public arbitrary-condition polling
helper. Use a loop with a deadline and interval if a more specific wait API does
not fit; [Pane
interaction](../pane-interaction/#waiting-for-something-to-finish) covers output
waits.

## tmux's own wait-for channel

Use `tmux wait-for -S <channel>` to signal and `tmux wait-for <channel>` to
block until signalled. This avoids repeated screen captures when the command can
announce its own completion:

| Port | Signal | Wait |
|------|--------|------|
| Python | `server.wait_for(channel, set_flag=True)` | `server.wait_for(channel)` |
| TypeScript | not exposed as public API: used only inside the test-server's own startup handshake | - |
| Go | `server.WaitFor(ctx, tmux.WaitForRequest{Channel: name, Mode: tmux.WaitForModeSignal})` | `tmux.WaitForRequest{Channel: name}` (the zero-value `Mode` waits) |
| Rust | `server.signal_channel(name).await?` | `server.wait_for_channel(name, timeout).await?` → `ChannelWait::Signalled` or `TimedOut` |
| Java | `server.channel(name).signal()` | `server.channel(name).await(timeout)` → a `WakeReason`, never silently "success" |
| .NET | `server.OpenWaitChannel(name)` returns a `TmuxWaitChannel`; signalling is the same request with a different mode | `await using` the channel, then `WaitAsync(budget)` |
| C++ | `server.signal(channel)` | `server.wait_for(channel, timeout)` |
| Swift | `try await server.signal(channel)` | `try await server.wait(for: channel)` |

```python
server.new_session(session_name="work")
server.wait_for("built", set_flag=True)  # signal
server.wait_for("built")                 # block until signalled
```

```go
server.WaitFor(ctx, tmux.WaitForRequest{Channel: "built", Mode: tmux.WaitForModeSignal})
server.WaitFor(ctx, tmux.WaitForRequest{Channel: "built"})
```

```rust
server.signal_channel("built").await?;
let outcome = server.wait_for_channel("built", std::time::Duration::from_secs(5)).await?;
```

```java
Channel built = server.channel("built");
built.signal();
WakeReason reason = built.await(Duration.ofSeconds(5));
```

```csharp
await using TmuxWaitChannel channel = server.OpenWaitChannel("built");
bool signalled = await channel.WaitAsync(TimeSpan.FromSeconds(5));
```

```cpp
server.signal("built");
server.wait_for("built", std::chrono::seconds{5});
```

```swift
try await server.signal("built")
try await server.wait(for: "built")
```

tmux remembers a signal sent before a waiter starts. The next wait on that
channel returns immediately, so completion is not lost when the command finishes
first.

A raw `wait-for` client can exit zero when the server dies, as well as when the
channel is signalled. Java's `WakeReason` and Swift's `wait(for:)` distinguish
server loss from a signal; Swift checks the server PID before and after the
wait.

Use a channel name specific to the task, or clear an old signal with Java's
`drain()` when appropriate. A remembered signal can otherwise satisfy an
unrelated later wait.
