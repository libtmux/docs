---
title: Waiting and retrying
description: Polling a condition instead of guessing a sleep, and tmux's own wait-for signal channel as the alternative to polling.
sidebar:
  label: Waiting and retrying
  group: Topics
  order: 8
tableOfContents: true
---

A command that changes tmux's state — new window, split, send a keystroke —
answers as soon as tmux has accepted it, not once whatever it triggered has
actually happened. [Pane interaction](../pane-interaction/#waiting-for-something-to-finish)
covers the specific, common case of that: waiting for text to show up in a
pane. This page is the more general version — waiting for *any* condition to
become true — and the one mechanism that isn't polling at all: tmux's own
`wait-for` signal channel, which every port reaches in some form.

## Polling a condition

The shape is always the same: call a check, and if it isn't true yet, wait a
short interval and call it again, until it's true or a deadline passes. Some
ports ship this as a reusable helper; most of the ones that do restrict it to
their test-support surface, because it's a fixture's problem far more often
than a production program's:

| Port | Helper | Where it lives |
|------|--------|-----------------|
| Python | `libtmux.test.retry_until(fn, seconds=, interval=)` | `libtmux.test` — ships in the same package, but under the test-support module; raises `WaitTimeout` |
| TypeScript | `connectedServer.waitFor(matches, options)` | the public library itself — but only on a control-mode connection ([Control mode vs one-shot](/concepts/transports/)), and the condition is a predicate over a whole `ServerSnapshot`, not a boolean thunk |
| Go | `tmuxtest.WaitFor(ctx, interval, condition)` | `tmuxtest`, a separate test-support package from `tmux` |
| Rust | `libtmux::test::retry_until(within, condition)` | `libtmux::test`, gated behind the `test-support` Cargo feature — an explicit opt-in, not just a namespace |
| Java | — | not found in the shipped library; a package-private `Await.until(...)` exists only inside the `integration-tests` module, which downstream code cannot depend on |
| .NET | `LibTmux.Testing.TmuxWait.UntilAsync(probe, timeout, interval)` | `LibTmux.Testing`, part of the same shipped `LibTmux` package |
| C++ | — | no generic condition-poll helper found in the public library; a `wait_until` exists only in the private `testing` component, for waiting on a spawned child process, not on tmux state |
| Swift | — | a `waitUntil` helper exists only inside the test target's own support code, not shipped |

Reading down that table: five ports ship *something*, and four of those five
mark it as test-support rather than production API — Python, Rust, and Go by
namespace or feature flag, .NET by putting it under `LibTmux.Testing` in the
same package. TypeScript's `waitFor` is the one genuine exception: it's part
of the ordinary public surface, not a test helper, because it answers a
different question — "has the *server* reached this state" rather than "has
this boolean become true" — and it needs a live connection to do it safely
(subscribe first, then read, so a change landing in between isn't missed).

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

Java, C++, and Swift have no shipped equivalent to reach for here: the
pattern is the same one written by hand — a loop, a check, a `sleep`, a
deadline — that [Pane interaction](../pane-interaction/#waiting-for-something-to-finish)
already shows Python writing out before `retry_until` covered the generic
case.

## tmux's own wait-for channel

Polling asks tmux the same question over and over. `wait-for` asks tmux to
*tell you* once, by having one command signal a named channel and another
block until it's signalled — no repeated round trips, and no interval to
tune. It's tmux's own primitive (`wait-for -S <channel>` to signal,
`wait-for <channel>` to block), not something any port invented, and every
one of the eight reaches it in some form:

| Port | Signal | Wait |
|------|--------|------|
| Python | `server.wait_for(channel, set_flag=True)` | `server.wait_for(channel)` |
| TypeScript | not exposed as public API — used only inside the test-server's own startup handshake | — |
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

A signal sent before anyone is waiting is not lost — tmux latches it, so the
next wait on that channel returns immediately. This is why the pattern shown
above (signal, then wait) is safe even though it looks backwards: the whole
point of a channel is that the two calls don't need to race each other.
Whoever is *waiting* wants the pattern the other way round — start the wait,
then run the command that signals it — but that's the same latch working in
your favor either way, not something you need to sequence carefully.

Two ports go further and turn the naive version of this into a real
guardrail rather than leaving it as a footgun. tmux's own `wait-for` exits
successfully both when the channel was genuinely signalled and when the
*server itself* went away out from under the waiter — a dead server makes
tmux's client exit zero, indistinguishable from a real signal, if nothing
checks further. Java's `WakeReason` and Swift's `wait(for:)` (which compares
the server's process ID before and after) both refuse to conflate the two;
plain `wait-for` output alone cannot tell them apart.

Java's `Channel` documents a second trap the others don't call out as
directly: a signal sent when nobody is waiting is remembered and satisfies
the *next* wait, possibly from an unrelated later run — so a channel's
history isn't yours alone unless you `drain()` it first to start from a
known state, or otherwise pick a name specific enough that two unrelated
pieces of work never collide on it.
