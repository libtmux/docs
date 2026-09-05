---
title: Capturing output
description: The visible pane versus its scrollback, why polling capture_pane in a loop is the wrong default, and what each port offers instead.
sidebar:
  label: Capturing output
  group: Guides
  order: 5
tableOfContents: true
---

Reading what a pane printed is the other half of the round trip
[Sending keys](../sending-keys/) covers the first half of. Two questions
come up every time: how much of the pane do you get back, and how do you
know when the thing you're waiting for has actually appeared?

## Visible pane vs. scrollback

`tmux capture-pane` distinguishes the currently visible screen from the
scrollback history above it, and every port exposes that split rather than
flattening it:

```python
# 0 is the first visible line; positive numbers stay in the visible pane;
# negative numbers reach into history; "-" means "the start of the
# history." With no arguments you get the visible screen.
>>> pane = window.split(shell='sh')
>>> pane.capture_pane()
['$']
```

```typescript
// start counts back from the visible top, so -100 asks for the last
// hundred lines or as many as exist.
const lines = await pane.capture({ start: -100 });
```

```go
// Same boundary vocabulary as Python's. CaptureBoundary on both ends means
// "just the visible screen."
lines, err := pane.Capture(ctx, tmux.CapturePaneRequest{
	Start: tmux.CaptureBoundary, End: tmux.CaptureBoundary,
})
```

```rust
// capture() for the visible screen; capture_with(...) for scrollback and
// other options.
let visible = pane.capture().await?;
```

```cpp
// A capture that doesn't fit is reported, not silently truncated —
// output_limit says how much you're prepared to hold.
const auto visible = pane.capture();
const auto history = pane.capture({.whole_history = true});
```

```swift
// The streaming form (below) additionally tracks a cursor, so a caller can
// ask for only what's new since the last read.
let lines = try await server.capture(pane)
```

Java's `pane.capture()` and .NET's `pane.CaptureAsync()` return the visible
pane as a list of lines; neither's own README shows a scrollback option as
of this page, so check the port's reference before assuming one exists.
Sources: TypeScript's is `examples/capture/capture.ts`, run by `bun test
examples/capture`. Go's is `examples/quickstart/main.go`. Rust's is
`crates/libtmux/README.md`'s capability table, doctested via `#![doc =
include_str!("../README.md")]`. C++'s is `README.md`'s "Read a pane"
section, quoted verbatim from `examples/05-readme.cpp`'s `capture` region
and checked by `tools/docs/check_readme.py`. Swift's is `README.md`,
"Change what is there."

## Don't poll — wait for the text instead

Reading a pane the instant after you send to it races the shell, as
[Sending keys](../sending-keys/#the-race-you-cant-see-from-the-call-site)
covers. A fixed `sleep` "fixes" this by guessing a delay that's either too
short (flaky) or too long (slow) — every port that takes testing or
automation seriously ships something better:

```go
// A wait that times out fails with the screen the pane last held rather
// than sending you back to add a print statement.
tmuxtest.WaitForText(ctx, t, pane, "ready")
```

```rust
// Looks before it sleeps (text already present is an answer, not a wait)
// and joins wrapped lines so a needle spanning a wrap still matches. The
// result is checked rather than discarded: a deadline reached is still an
// answer you have to look at, not a silent pass.
match pane.wait_for_text("ready", Duration::from_secs(10)).await? {
    PaneWait::Arrived => {}
    PaneWait::Dead => { /* the pane's process ended before it showed up */ }
    PaneWait::TimedOut => { /* still alive, but the deadline ran out first */ }
}
```

```typescript
// No fixed-poll helper: subscribe to the event stream *before* sending,
// then wait for the specific event, so a marker printed between the two
// calls is never missed.
const found = live.subscribe().find(
  (event) => event.kind === "output" && event.paneId === pane.id && event.data.includes(marker),
  { timeoutMs: 30_000 },
);
await pane.sendKeys(command);
await found;
```

```java
// A client has to attach first — attaching is what makes tmux push
// %output at all; a client that never attaches hears command replies and
// nothing else.
EventSubscription<PaneOutput> output = client.subscribeOutput(32);
```

```csharp
// Polls a read function against a predicate rather than sleeping a fixed
// amount.
string output = await TmuxWait.UntilAsync(
    async token => string.Join('\n', await pane.CaptureAsync(cancellationToken: token)),
    text => text.Contains("hello-from-libtmux", StringComparison.Ordinal),
    TimeSpan.FromSeconds(10),
    TimeSpan.FromMilliseconds(20));
```

```swift
// Takes patterns for both success and failure, so a process that fails
// fast doesn't have to be discovered by timeout.
try await server.waitForOutput(in: pane, matching: [ready], stoppingAt: [failed])
```

Python's own pytest plugin gives tests a real, isolated server (see
[Testing with libtmux](../testing-with-libtmux/)), but a documented
wait-for-text helper for ordinary, non-test code wasn't found in the checked
source for this page — `server.wait_for(...)`, below, covers the adjacent
"wait for a signal" case. C++ has no equivalent poll-for-text helper either;
its own wait primitive is the signal channel covered next.

Sources: Go's is `tmux/tmuxtest/screen.go`, quoted in `README.md`'s "Testing
your own code" section. Rust's is `crates/libtmux/README.md`, doctested.
TypeScript's is `examples/agent/agent.ts`, run by the integration suite and
quoted in `packages/libtmux/README.md` (`<!-- runs: examples/agent/agent.ts
-->`). Java's is `examples/.../WatchPaneOutput.java`. .NET's is `README.md`,
one of the `csharp run` blocks `ReadmeExampleTests` runs. Swift's is
`Examples/Sources/ExampleCode/Waiting.swift`, matched against
`<doc:Waiting>` and the README by `Scripts/check_examples.py`; the same
file's `server.capture(pane, since: mark)`, called in a loop with the cursor
it returns, is the "watch as it prints" shape for output too large or too
open-ended to wait on a single pattern.

## When the pane can announce itself: `wait-for`, not scraping

If the command you're running can be made to say when it's done — appending
`; tmux wait-for -S done` to it, say — several ports expose tmux's own
signal-channel primitive directly, which needs no text matching at all:

```python
>>> server.new_session(session_name='wait_test')
Session(...)
>>> server.wait_for('test_channel', set_flag=True)
```

Verified doctest, `src/libtmux/server.py`. C++'s `Server::wait_for(channel,
timeout)` is the same idea, with a specific reason to prefer it over
scraping output for a marker: "a server that dies under a waiter makes tmux
exit zero, which is indistinguishable from being signalled — a caller
would carry on as though the other side had spoken. This reports that as a
failure instead" (source: `include/libtmux/server.hpp`). Swift's
`server.wait(for:)` channel example runs a build and blocks on its own
completion signal rather than watching for text to scroll by:

```swift file="Examples/Sources/ExampleCode/Waiting.swift" region="guides-capturing-output-176"
```

Source: `Examples/Sources/ExampleCode/Waiting.swift`. Rust's
`crates/libtmux/README.md` documents the same pattern under "tmux keeps a
signal nobody is waiting on, so the job finishing first does not lose the
race, and nothing polls," runnable as `examples/orchestrate.rs`.

## Where to go next

- [Filtering and querying, in practice](../querying-and-filtering/) — once
  you're reading more than one pane, finding the right one to capture.
- [Testing with libtmux](../testing-with-libtmux/) — the isolated-server
  fixtures that make waiting on real tmux practical inside a test suite.
- [Capture pane output](/examples/capture-pane-output/) — the full
  sourced code for the patterns above.
