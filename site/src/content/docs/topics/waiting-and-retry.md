---
supportedPorts: [py, ts, rs, go, java, dotnet, cxx, swift]
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
Set a deadline and choose an interval that limits unnecessary tmux commands.

<!-- port:py -->
<!-- port:root -->
### Python
<!-- /port -->

**Helper:** `libtmux.test.retry_until(fn, seconds=, interval=)`

**Where it lives:** `src/libtmux/test/` in the main package; raises
`WaitTimeout`.
<!-- /port -->

<!-- port:ts -->
<!-- port:root -->
### TypeScript
<!-- /port -->

**Helper:** `connectedServer.waitFor(matches, options)`

**Where it lives:** The public control-connection API. Tests a predicate over
`ServerSnapshot`; see [Control mode vs one-shot](/concepts/transports/).
<!-- /port -->

<!-- port:go -->
<!-- port:root -->
### Go
<!-- /port -->

**Helper:** `tmuxtest.WaitFor(ctx, interval, condition)`

**Where it lives:** `tmuxtest`, a separate test-support package from `tmux`
<!-- /port -->

<!-- port:rs -->
<!-- port:root -->
### Rust
<!-- /port -->

**Helper:** `libtmux::test::retry_until(within, condition)`

**Where it lives:** `crates/libtmux/src/test.rs`, enabled with the `test-support` Cargo
feature.
<!-- /port -->

<!-- port:java -->
<!-- port:root -->
### Java
<!-- /port -->

**Helper:** Not listed.

**Where it lives:** not found in the shipped library; a package-private
`Await.until(...)` exists only inside the `integration-tests` module, which
downstream code cannot depend on
<!-- /port -->

<!-- port:dotnet -->
<!-- port:root -->
### .NET
<!-- /port -->

**Helper:** `LibTmux.Testing.TmuxWait.UntilAsync(probe, timeout, interval)`

**Where it lives:** the separate `LibTmux.Testing` package
<!-- /port -->

<!-- port:cxx -->
<!-- port:root -->
### C++
<!-- /port -->

**Helper:** Not listed.

**Where it lives:** no generic condition-poll helper found in the public
library; a `wait_until` exists only in the private `testing` component, for
waiting on a spawned child process, not on tmux state
<!-- /port -->

<!-- port:swift -->
<!-- port:root -->
### Swift
<!-- /port -->

**Helper:** Not listed.

**Where it lives:** a `waitUntil` helper exists only inside the test target's
own support code, not shipped
<!-- /port -->

### Examples

<!-- port:ts -->
`waitFor` subscribes before reading a server snapshot so it does not miss a
change between those steps.
<!-- /port -->
<!-- port:go -->
`tmuxtest.WaitFor` probes immediately, then at the requested positive interval.
It returns a probe error or context error unchanged. Each probe must read fresh
state and honor its context. `Session.Windows()` only reads a stored snapshot;
use `Session.SearchWindows` to query tmux on every probe.
<!-- /port -->

```python
def is_window_up(pane, name):
    return any(w.window_name == name for w in pane.window.session.windows)

libtmux.test.retry_until(lambda: is_window_up(pane, "build"), seconds=5.0)
```

```typescript
await using live = await server.connect();
await live.waitFor((snapshot) => snapshot.windows.exists({ name: "build" }));
```

```go
waitCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
defer cancel()
err := tmuxtest.WaitFor(waitCtx, 50*time.Millisecond, func(ctx context.Context) (bool, error) {
	windows, err := session.SearchWindows(ctx, nil)
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
if err != nil {
    return fmt.Errorf("wait for build window: %w", err)
}
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

<!-- port:java,cxx,swift -->
Use a loop with a deadline and interval when a specific wait API does not fit.
[Pane interaction](../pane-interaction/#waiting-for-something-to-finish)
covers output waits.
<!-- /port -->

## tmux's own wait-for channel

Use `tmux wait-for -S <channel>` to signal and `tmux wait-for <channel>` to
block until signalled. This avoids repeated screen captures when the command can
announce its own completion:

| Port | Signal | Wait |
|------|--------|------|
<!-- port:py -->| Python | `server.wait_for(channel, set_flag=True)` | `server.wait_for(channel)` |
<!-- /port --><!-- port:ts -->| TypeScript | not exposed as public API: used only inside the test-server's own startup handshake | - |
<!-- /port --><!-- port:go -->| Go | `server.WaitFor(ctx, tmux.WaitForRequest{Channel: name, Mode: tmux.WaitForModeSignal})` | `tmux.WaitForRequest{Channel: name}` (the zero-value `WaitForRequest.Mode` waits) |
<!-- /port --><!-- port:rs -->| Rust | `server.signal_channel(name).await?` | `server.wait_for_channel(name, timeout).await?` → `ChannelWait::Signalled` or `TimedOut` |
<!-- /port --><!-- port:java -->| Java | `server.channel(name).signal()` | `server.channel(name).await(timeout)` → a `WakeReason`, never silently "success" |
<!-- /port --><!-- port:dotnet -->| .NET | `server.OpenWaitChannel(name)` returns a `TmuxWaitChannel`; signalling is the same request with a different mode | `await using` the channel, then `WaitAsync(budget)` |
<!-- /port --><!-- port:cxx -->| C++ | `server.signal(channel)` | `server.wait_for(channel, timeout)` |
<!-- /port --><!-- port:swift -->| Swift | `try await server.signal(channel)` | `try await server.wait(for: channel)` |
<!-- /port -->
```python
server.new_session(session_name="work")
server.wait_for("built", set_flag=True)  # signal
server.wait_for("built")                 # block until signalled
```

```go
if err := server.WaitFor(ctx, tmux.WaitForRequest{
    Channel: "built", Mode: tmux.WaitForModeSignal,
}); err != nil {
    return err
}
if err := server.WaitFor(ctx, tmux.WaitForRequest{Channel: "built"}); err != nil {
    return err
}
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
channel is signalled. Verify server liveness when a lost server must be treated
as a failed task.

<!-- port:java -->
Check `WakeReason` to distinguish server loss from a signal. `drain()` can
clear a remembered signal before reusing a channel.
<!-- /port -->
<!-- port:swift -->
`wait(for:)` checks the server PID before and after waiting to distinguish
server loss from a signal.
<!-- /port -->

Use a channel name specific to the task. A remembered signal can otherwise
satisfy an unrelated later wait.

<!-- port:root -->
The [wait-for reference](/tmux/latest/reference/wait-for/) describes completion
signals and locks for each supported tmux version.
<!-- /port -->

<details>
<summary>tmux manual and source</summary>

The tmux manual describes [completion channels](https://github.com/tmux/tmux/blob/94796f6b1182507efac8a272fc309a79e22e58a5/tmux.1#L8715).
The [channel implementation](https://github.com/tmux/tmux/blob/94796f6b1182507efac8a272fc309a79e22e58a5/cmd-wait-for.c#L388)
retains an early signal until a waiter consumes it. Use a fresh channel name
for each operation.

</details>
