---
title: Capture pane output
description: Capture a pane's screen and wait for expected output or a completion signal.
sidebar:
  label: Capture pane output
  group: Examples
  order: 3
tableOfContents: true
---

Read a pane after [sending input](../attach-and-send-keys/). [Sending
keys](/guides/sending-keys/#the-race-you-cant-see-from-the-call-site) explains
why an immediate capture can miss output. These examples show screen capture and
waiting; [Capturing output](/guides/capturing-output/) explains the choices. See
[source details](#where-this-comes-from) for each example's source and
validation.

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

The .NET example under "Wait for text instead of guessing a delay" uses
`Pane.CaptureAsync` within a wait. Its separate Psmux transport also provides a
capture API, shown in `examples/LibTmux.Examples/Snippets/Psmux.cs`.

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
// From Examples/Sources/ExampleCode/Changing.swift, readBackWhatAPanePrinted: shown in full on Attach and send keys.
let lines = try await server.capture(pane)
```

## Wait for text instead of guessing a delay

The Python example uses `wait_for`, tmux's signal channel. It waits for a signal
from the command rather than matching pane text.

```python
>>> server.new_session(session_name='wait_test')
Session(...)
>>> server.wait_for('test_channel', set_flag=True)
```

```typescript file="examples/agent/agent.ts"
```

```go file="examples/control-mode-subscribe/main.go"
```

`Session.OpenNotifications` receives tmux events as a stream. For tests that
need to wait for screen text, use `tmuxtest.WaitForText`; see [Testing with
libtmux](/guides/testing-with-libtmux/).

```rust
// From crates/libtmux/examples/scratch.rs, the wait_for_text call: shown in full on Attach and send keys.
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

Attach the `ControlClient` to receive `%output` notifications. An unattached
client receives command replies only.

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

### Python

**Source:** `src/libtmux/pane.py` (`capture_pane`), `src/libtmux/server.py`
(`wait_for`) docstrings

**In this page:** hand-quoted

**Checked by:** `pytest` runs every `>>>` doctest against a real, isolated tmux
session on every test run

### TypeScript

**Source:** `examples/capture/capture.ts` (read), `examples/agent/agent.ts`
(wait)

**In this page:** read whole from each file

**Checked by:** both run against real tmux by `bun test examples`; `agent.ts` is
additionally mirrored into README.md under a `<!-- runs: ... -->` marker checked
by `scripts/check-doc-runnable.ts`

### Go

**Source:** `examples/quickstart/main.go` (read, already shown whole on the
previous page), `examples/control-mode-subscribe/main.go` (wait)

**In this page:** read: hand-quoted; wait: read whole from the file

**Checked by:** both run against real tmux as `TestQuickstart` /
`TestControlModeSubscribe`; the wait file's `docs:watching` region is
additionally mirrored into README.md by `go generate ./tmux`

### Rust

**Source:** `crates/libtmux/examples/scratch.rs`, already shown whole on the
previous page

**In this page:** hand-quoted excerpts of the same file

**Checked by:** run to completion against a throwaway tmux by
`scripts/run-examples.sh`, which CI runs

### Java

**Source:** root `README.md` Quickstart (read),
`examples/src/main/java/io/github/libtmux/examples/WatchPaneOutput.java` (wait)

**In this page:** read: hand-quoted; wait: read whole from the file

**Checked by:** every README fence is compiled and run against real tmux by
`docs-tests`; `WatchPaneOutput` is additionally run by the `examples` module's
`ExamplesRunTest`

### .NET

**Source:** root `README.md`, "Running something, and reading it back"

**In this page:** hand-quoted

**Checked by:** one of the `csharp run` blocks compiled and run against real
tmux by `ReadmeExampleTests`

### C++

**Source:** `examples/05-readme.cpp` `capture` region (read);
`include/libtmux/server.hpp` doc comment (wait, no fence)

**In this page:** hand-quoted

**Checked by:** the `capture` region is quoted verbatim into README.md and
checked by `tools/docs/check_readme.py`; the whole file is built and run by
CTest

### Swift

**Source:** `Examples/Sources/ExampleCode/Changing.swift` (read, already shown
whole on the previous page), `Waiting.swift` (wait)

**In this page:** read: hand-quoted excerpt; wait: read whole from the file

**Checked by:** both matched against the README by `Scripts/check_examples.py`
and run by `swift test --package-path Examples`

### Source inclusion

Go, Rust, and Swift each reuse a file already shown in full on
[Attach and send keys](../attach-and-send-keys/#where-this-comes-from):
rather than dump the same file a second time, this page quotes just the
relevant lines by hand, with a comment naming the source, and points back
at the full listing there.
