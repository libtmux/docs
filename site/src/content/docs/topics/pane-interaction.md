---
title: Pane interaction
description: Typing into a pane and reading its screen back — the enter/literal choices going in, and waiting for something to finish coming out.
sidebar:
  label: Pane interaction
  group: Topics
  order: 5
tableOfContents: true
---

A pane is the one object in the hierarchy you actually drive: you type into
it and read back what it printed. Every port reduces to the same two
operations — send keys, capture the screen — and
[Attach and send keys](/examples/attach-and-send-keys/) already shows
each one doing exactly that, checked against that port's own tests. This
page is the layer underneath: the design choices each port made for *how*
you type and *how* you read, and where they genuinely differ.
[Sending keys](/guides/sending-keys/) and [Capturing
output](/guides/capturing-output/) are the task-oriented walkthroughs
for actually doing this; this page is for understanding the shape once you
're past the basics.

## Typing into a pane

Two questions come up every time you send something to a pane: should tmux
press Enter afterward, and should tmux interpret what you sent as key names
(`Enter`, `C-c`) rather than literal characters? Ports answer both, but
disagree on whether that's one method with flags or two separate methods:

| Port | Type without Enter | Type + Enter (default) | How "literal" is chosen |
|------|----------------------|---------------------------|----------------------------|
| Python | `pane.send_keys(text, enter=False)` | `pane.send_keys(text)` | `literal=True` flag on the same method |
| TypeScript | `pane.sendKeys(text, { enter: false })` | `pane.sendKeys(text)` | `{ literal: true }` option |
| Go | `pane.SendKeys(ctx, SendKeysRequest{Command: &text, SkipEnter: true})` | `pane.SendKeys(ctx, SendKeysRequest{Command: &text})` | `Literal: true` field |
| Rust | `pane.send_keys(keys)` — **always literal**, key names typed as text | `pane.send_line(text)` | `send_key_names(keys)` is the *interpreted* one — the opposite of what "send_keys" means everywhere else |
| Java | `pane.send(keys)` | `pane.sendLine(command)` | two methods, deliberately not a boolean — "so a call site says which it means" (the library's own doc comment) |
| .NET | `SendKeysAsync(new SendKeysRequest(text, enter: false))` | `SendTextAsync(text)` (defaults `enter: true`) | `Literal` field on `SendKeysRequest`; `SendTextAsync` hardcodes it |
| C++ | `pane->send_text(text)` | `send_text(text)` then `send_key("Enter")` separately — no combined convenience exists | `send_text` is always literal; `send_key` is always a key name |
| Swift | `server.sendKeys([text], to: pane)` | `server.run(text, in: pane)` (sugar for `sendKeys([text, "Enter"], to: pane)`) | `literally: true` option on `sendKeys` |

**Rust is the one genuine trap.** In every other port, "send keys" defaults
to *interpreting* what you send — key names like `C-c` or `Enter` do what
they mean — and a literal flag opts out of that. Rust inverts it: `send_keys`
is *always* literal (tmux's `-l` flag), and `send_key_names` is what
interprets tmux's key vocabulary. Code ported from another language's
`send_keys(...)` call will silently type the five characters `Enter`
instead of pressing the key if you assume the name means what it means
elsewhere.

**Enter is a separate tmux command in most ports, and that's a deliberate
choice, not an oversight.** Python, TypeScript, Go, and .NET all default to
sending Enter, and all four dispatch it as its own `send-keys` afterward
rather than folding it into the text. TypeScript's own source states the
reason directly: `-l` sends a *literal* newline character, which is not the
same byte sequence as the `Enter` key name tmux resolves — keeping the two
dispatches separate is what lets `literal` mean only the caller's own text.
The cost is a real one: .NET's `SendTextAsync` documents it as a two-step
exposure ("Enter rides in its own command... appended to a literal send it
would type the five characters of its name") and its exception for a failed
Enter says outright not to retry the whole request, since the text may
already have landed. C++'s `send_text` / `send_key("Enter")` carries the
same exposure with nothing hiding it.

**Rust's `send_line` and Java's `sendLine` avoid the exposure entirely**,
and by the same trick: both append a literal `\r` onto the text itself and
send it as *one* `send-keys -l` call, rather than dispatching Enter
separately. There's no window where the text could have gone through
without it — not because the operation is guarded, but because there's
only ever one operation.

Typing a command and pressing Enter, in each port — with the trap above in
mind for Rust:

```python
pane.send_keys("echo hi", enter=False)  # type without pressing Enter
pane.send_keys("echo hi")               # default: presses Enter afterward
```

```typescript
await pane.sendKeys("echo hi", { enter: false });
await pane.sendKeys("echo hi");
```

```go
text := "echo hi"
pane.SendKeys(ctx, tmux.SendKeysRequest{Command: &text, SkipEnter: true})
pane.SendKeys(ctx, tmux.SendKeysRequest{Command: &text})
```

```rust
pane.send_keys("echo hi").await?; // always literal — the trap above
pane.send_line("echo hi").await?; // text and Enter in one send-keys -l call
```

```java
pane.send("echo hi");     // no Enter
pane.sendLine("echo hi"); // text and \r in one send-keys -l call
```

```csharp
await pane.SendKeysAsync(new SendKeysRequest("echo hi", enter: false));
await pane.SendTextAsync("echo hi"); // defaults enter: true
```

```cpp
pane->send_text("echo hi");
pane->send_key("Enter"); // separate command — no combined convenience exists
```

```swift
try await server.sendKeys(["echo hi"], to: pane) // no Enter
try await server.run("echo hi", in: pane)        // sugar for sendKeys([text, "Enter"])
```

## Reading a pane back

Every port hands the screen back as a list of lines, top to bottom:
`pane.capture_pane()` (Python), `pane.capture()` (TypeScript, Rust, Java,
C++), `pane.Capture(ctx, ...)` (Go), `CaptureAsync(...)` (.NET),
`server.capture(pane)` (Swift). With no arguments you get the visible
screen; every port that exposes scrollback (history beyond what's currently
on screen) does it through an explicit range or flag on that same call
rather than a separate method — Python's `start`/`end` line-range
parameters and Swift's `includingHistory: Bool` are the two verified shapes
of that choice.

```python
pane.capture_pane()
```

```typescript
await pane.capture();
```

```go
pane.Capture(ctx, tmux.CapturePaneRequest{}) // the zero value: visible screen
```

```rust
pane.capture().await?;
```

```java
pane.capture();
```

```csharp
await pane.CaptureAsync();
```

```cpp
pane->capture();
```

```swift
try await server.capture(pane)
```

## Waiting for something to finish

`send_keys` returns the instant the keystrokes are sent, not when whatever
you typed finishes running — every port shares that limitation, because it
falls straight out of tmux itself being asynchronous. What ports genuinely
differ on is whether they hand you something better than a loop:

- **Python**'s own docs show you writing the polling loop yourself: capture
  on an interval, check for a marker string, stop when it appears — that's
  the documented pattern for "did my command finish," even though Python
  separately ships a generic `libtmux.test.retry_until(condition, ...)` in
  its test-support module for polling *some* condition on a fixed interval.
  [Waiting and retrying](../waiting-and-retry/) covers that helper and its
  equivalents (or lack of one — Java ships nothing past its own test suite)
  across all eight ports.
- **Swift** ships a real primitive for exactly this:
  `server.waitForOutput(...)` returns an `OutputWait` once a pattern shows
  up in the pane, rather than leaving you to write the loop.
- **Go** and **.NET** additionally expose tmux's own `wait-for` command —
  `server.WaitFor(ctx, WaitForRequest{...})` in Go, a `TmuxWaitChannel` in
  .NET — which is a *different* mechanism from polling captured output: it's
  tmux's native named-channel signal (`wait-for -S name` from one command,
  `wait-for name` blocking in another), not a scan of what's on screen. Use
  it when the thing you're waiting for is a command finishing, not
  particular text appearing.

[Capture pane output](/examples/capture-pane-output/) has the checked,
per-port code for the polling-with-a-marker version of this; reach for a
port's native wait primitive above it where one exists.
