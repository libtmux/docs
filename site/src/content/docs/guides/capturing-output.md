---
supportedPorts: [py, ts, rs, go, java, dotnet, cxx, swift]
title: Capturing output
description: Read a pane's screen or scrollback and wait for output or a completion signal.
sidebar:
  label: Capturing output
  group: Guides
  order: 5
tableOfContents: true
---

Capture a pane to read its visible screen or scrollback. After [Sending
keys](../sending-keys/), wait for the expected output or a completion signal
before reading the result.

## Visible pane vs. scrollback

`tmux capture-pane` distinguishes the currently visible screen from the
scrollback history above it. Choose the range required by your task:

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
// Include scrollback from its beginning through the bottom of the screen.
lines, err := pane.Capture(ctx, tmux.CapturePaneRequest{
	Start: tmux.CaptureBoundary, End: tmux.CaptureBoundary,
})
if err != nil {
    return err
}
for _, line := range lines {
    fmt.Println(line)
}
```

```rust
// capture() for the visible screen; capture_with(...) for scrollback and
// other options.
let visible = pane.capture().await?;
```

```cpp
// A capture that doesn't fit is reported, not silently truncated:
// output_limit says how much you're prepared to hold.
const auto visible = pane.capture();
const auto history = pane.capture({.whole_history = true});
```

```swift
// The streaming form (below) additionally tracks a cursor, so a caller can
// ask for only what's new since the last read.
let lines = try await server.capture(pane)
```

<!-- port:java -->
`pane.capture()` returns visible pane contents as a list of lines.
<!-- /port -->
<!-- port:dotnet -->
`pane.CaptureAsync()` returns visible pane contents as a list of lines.
<!-- /port -->

[Capture pane output](/examples/capture-pane-output/) includes complete
programs and source details.

<a id="dont-poll-wait-for-the-text-instead"></a>

## Wait for the expected text

An immediate capture can race the shell, as [Sending
keys](../sending-keys/#the-race-you-cant-see-from-the-call-site) explains. Wait
for the expected text with a timeout so your program stops promptly when the
output arrives and reports a failure if it never does:

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
// A client has to attach first: attaching is what makes tmux push
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

<!-- port:py,cxx -->
Use a completion channel when the program can announce that its work is done.
The next section explains that protocol.
<!-- /port -->

[Testing with libtmux](../testing-with-libtmux/) explains isolated servers
and fixtures. [Capture pane output](/examples/capture-pane-output/) provides
the full examples.

<a id="when-the-pane-can-announce-itself-wait-for-not-scraping"></a>

## Wait for a completion signal

If you control the command, have it signal completion with `tmux wait-for -S
done`. Wait on the same channel to avoid matching screen text:

```python
>>> server.new_session(session_name='wait_test')
Session(...)
>>> server.wait_for('test_channel', set_flag=True)
```

<!-- port:cxx -->
`Server::wait_for(channel, timeout)` also detects a server that dies during
the wait and reports failure.
<!-- /port -->

```swift
import LibTmux

public func waitingOnAChannel(_ server: Server, pane: Pane) async throws {
    try await server.run(
        "make; \(server.shellInvocation) wait-for -S built",
        in: pane
    )
    try await server.wait(for: "built")
}
```

Use a distinct channel name for each task. tmux remembers a signal sent before
a waiter starts; reusing a signalled name can therefore finish an unrelated
later wait. [Waiting and retrying](/topics/waiting-and-retry/) covers channel
APIs and server-loss handling.

## Where to go next

- [Filtering and querying, in practice](../querying-and-filtering/): once
  you're reading more than one pane, finding the right one to capture.
- [Testing with libtmux](../testing-with-libtmux/): the isolated-server
  fixtures that make waiting on real tmux practical inside a test suite.
- [Capture pane output](/examples/capture-pane-output/): the full
  sourced code for the patterns above.
