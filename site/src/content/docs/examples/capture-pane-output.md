---
title: Capture pane output
description: Read back what a pane is showing, and wait for text to appear instead of guessing a delay — the checked snippet in each port that has one.
sidebar:
  label: Capture pane output
  group: Examples
  order: 3
tableOfContents: true
---

The other half of [Attach and send keys](../attach-and-send-keys/): reading
what a pane printed, and — since tmux accepts a command before the shell
running it has necessarily finished (see
[Sending keys](/guides/sending-keys/#the-race-you-cant-see-from-the-call-site))
— waiting for the right moment to read rather than reading immediately or
sleeping a guessed amount. [Capturing output](/guides/capturing-output/)
is the guide-level discussion of why each pattern below exists; this page
is the sourced code behind it — see
[the table at the end](#where-this-comes-from) for exactly which file each
block came from and how it's checked.

## Read what's on screen

```python
>>> pane = window.split(shell='sh')
>>> pane.capture_pane()
['$']

>>> pane.send_keys('echo "Hello world"', enter=True)

>>> pane.capture_pane()
['$ echo "Hello world"', 'Hello world', '$']
```

```typescript file="examples/capture/capture.ts"
```

```go
// From examples/quickstart/main.go, shown in full on Attach and send keys.
lines, err := pane.Capture(ctx, tmux.CapturePaneRequest{
	Start: tmux.CaptureBoundary,
	End:   tmux.CaptureBoundary,
})
```

```rust file="crates/libtmux/examples/scratch.rs" region="capture"
```

```java
Pane pane = server.sessions().get(0).windows().get(0).panes().get(0);

pane.sendLine("echo hello from libtmux");

pane.capture().isEmpty();            // → false
```

No checked .NET example calls the ordinary `Pane.CaptureAsync` by itself
outside a wait — the README's own read is the block under "Wait for text
instead of guessing a delay" below, and the separate `Psmux` surface has its
own `CaptureAsync` for that different transport
(`examples/LibTmux.Examples/Snippets/Psmux.cs`).

```cpp
const auto visible = pane.capture();
if (visible.has_value()) {
  std::printf("%zu bytes on screen\n", visible->size());
}

const auto history = pane.capture({.whole_history = true});
if (history.has_value()) {
  std::printf("%zu bytes of scrollback\n", history->size());
}
```

```swift
// From Examples/Sources/ExampleCode/Changing.swift, readBackWhatAPanePrinted — shown in full on Attach and send keys.
let lines = try await server.capture(pane)
```

## Wait for text instead of guessing a delay

Python's checked wait is `wait_for`, tmux's own signal channel, rather than
a helper that scrapes pane text for a pattern — no checked helper that
waits on pane *text* was found in the source for this page.

```python
>>> server.new_session(session_name='wait_test')
Session(...)
>>> server.wait_for('test_channel', set_flag=True)
```

```typescript file="examples/agent/agent.ts"
```

```go file="examples/control-mode-subscribe/main.go"
```

`Session.OpenNotifications` streams what tmux does as it happens rather than
polling — tmux pushes each change instead of a poll guessing how often to
ask. `tmuxtest.WaitForText` (see
[Testing with libtmux](/guides/testing-with-libtmux/)) is the equivalent
built specifically for tests.

```rust
// From crates/libtmux/examples/scratch.rs, the wait_for_text call — shown in full on Attach and send keys.
match pane.wait_for_text("hello", Duration::from_secs(5)).await? {
    PaneWait::Arrived => println!("  the pane printed it"),
    other => println!("  gave up: {other:?}"),
}
```

Rust's `wait_for_text` looks before it sleeps, joins wrapped lines so a
needle spanning a wrap still matches, and returns `PaneWait::Dead` rather
than hanging forever if the pane's process ends first.

```java file="examples/src/main/java/io/github/libtmux/examples/WatchPaneOutput.java"
```

Attaching a `ControlClient` is what makes tmux push `%output` at all — a
client that never attaches only ever hears command replies.

```csharp
await pane.SendTextAsync("echo hello-from-libtmux", cancellationToken: ct);
await pane.EnterAsync(ct);

string output = await TmuxWait.UntilAsync(
    async token => string.Join('\n', await pane.CaptureAsync(cancellationToken: token)),
    text => text.Contains("hello-from-libtmux", StringComparison.Ordinal),
    TimeSpan.FromSeconds(10),
    TimeSpan.FromMilliseconds(20));
```

`TmuxWait.UntilAsync` polls a read against a predicate rather than sleeping
a fixed amount.

C++ has no checked snippet that waits on pane *text*. `Server::wait_for(channel,
timeout)`, in `include/libtmux/server.hpp`, uses tmux's own `wait-for` signal
instead of scraping output, and its doc comment explains why that is the
safer choice when the command you are waiting on can be made to announce
itself: "a server that dies under a waiter makes tmux exit zero, which is
indistinguishable from being signalled ... this reports that as a failure
instead."

```swift file="Examples/Sources/ExampleCode/Waiting.swift"
```

`waitForOutput` takes patterns for both success and failure, so a process
that fails fast is discovered immediately rather than by timing out.

## Where this comes from

| Port | Source | In this page | Checked by |
|---|---|---|---|
| Python | `src/libtmux/pane.py` (`capture_pane`), `src/libtmux/server.py` (`wait_for`) docstrings | hand-quoted | `pytest` runs every `>>>` doctest against a real, isolated tmux session on every test run |
| TypeScript | `examples/capture/capture.ts` (read), `examples/agent/agent.ts` (wait) | read whole from each file | both run against real tmux by `bun test examples`; `agent.ts` is additionally mirrored into README.md under a `<!-- runs: ... -->` marker checked by `scripts/check-doc-runnable.ts` |
| Go | `examples/quickstart/main.go` (read, already shown whole on the previous page), `examples/control-mode-subscribe/main.go` (wait) | read: hand-quoted; wait: read whole from the file | both run against real tmux as `TestQuickstart` / `TestControlModeSubscribe`; the wait file's `docs:watching` region is additionally mirrored into README.md by `go generate ./tmux` |
| Rust | `crates/libtmux/examples/scratch.rs`, already shown whole on the previous page | hand-quoted excerpts of the same file | run to completion against a throwaway tmux by `scripts/run-examples.sh`, which CI runs |
| Java | root `README.md` Quickstart (read), `examples/src/main/java/io/github/libtmux/examples/WatchPaneOutput.java` (wait) | read: hand-quoted; wait: read whole from the file | every README fence is compiled and run against real tmux by `docs-tests`; `WatchPaneOutput` is additionally run by the `examples` module's `ExamplesRunTest` |
| .NET | root `README.md`, "Running something, and reading it back" | hand-quoted | one of the `csharp run` blocks compiled and run against real tmux by `ReadmeExampleTests` |
| C++ | `examples/05-readme.cpp` `capture` region (read); `include/libtmux/server.hpp` doc comment (wait, no fence) | hand-quoted | the `capture` region is quoted verbatim into README.md and checked by `tools/docs/check_readme.py`; the whole file is built and run by CTest |
| Swift | `Examples/Sources/ExampleCode/Changing.swift` (read, already shown whole on the previous page), `Waiting.swift` (wait) | read: hand-quoted excerpt; wait: read whole from the file | both matched against the README by `Scripts/check_examples.py` and run by `swift test --package-path Examples` |

Go, Rust, and Swift each reuse a file already shown in full on
[Attach and send keys](../attach-and-send-keys/#where-this-comes-from):
rather than dump the same file a second time, this page quotes just the
relevant lines by hand, with a comment naming the source, and points back
at the full listing there.
