---
title: Pane interaction
description: Input defaults, screen capture, and waiting for a command to finish.
sidebar:
  label: Pane interaction
  group: Topics
  order: 5
tableOfContents: true
---

Send input to a pane and capture its screen to interact with a running program.
[Attach and send keys](/examples/attach-and-send-keys/) provides examples.
[Sending keys](/guides/sending-keys/) and [Capturing
output](/guides/capturing-output/) are task guides; this page compares input
defaults, capture ranges, and completion handling.

## Typing into a pane

Two questions come up every time you send something to a pane: should tmux
press Enter afterward, and should tmux interpret what you sent as key names
(`Enter`, `C-c`) rather than literal characters? Ports answer both, but
disagree on whether that's one method with flags or two separate methods:

### Python

**Type without Enter:** `pane.send_keys(text, enter=False)`

**Type + Enter (default):** `pane.send_keys(text)`

**How "literal" is chosen:** `literal=True` flag on the same method

### TypeScript

**Type without Enter:** `pane.sendKeys(text, { enter: false })`

**Type + Enter (default):** `pane.sendKeys(text)`

**How "literal" is chosen:** `{ literal: true }` option

### Go

**Type without Enter:** `pane.SendKeys(ctx, SendKeysRequest{Command: &text,
SkipEnter: true})`

**Type + Enter (default):** `pane.SendKeys(ctx, SendKeysRequest{Command:
&text})`

**How "literal" is chosen:** `Literal: true` field

### Rust

**Type without Enter:** `pane.send_keys(keys)`: **always literal**, key names
typed as text

**Type + Enter (default):** `pane.send_line(text)`

**How "literal" is chosen:** `send_keys` sends literal text; `send_key_names`
interprets tmux key names.

### Java

**Type without Enter:** `pane.send(keys)`

**Type + Enter (default):** `pane.sendLine(command)`

**How "literal" is chosen:** Separate text and key-sending methods.

### .NET

**Type without Enter:** `SendKeysAsync(new SendKeysRequest(text, enter: false))`

**Type + Enter (default):** `SendTextAsync(text)` (defaults `enter: true`)

**How "literal" is chosen:** `Literal` field on `SendKeysRequest`;
`SendTextAsync` hardcodes it

### C++

**Type without Enter:** `pane->send_text(text)`

**Type + Enter (default):** `send_text(text)` then `send_key("Enter")`
separately: no combined convenience exists

**How "literal" is chosen:** `send_text` is always literal; `send_key` is always
a key name

### Swift

**Type without Enter:** `server.sendKeys([text], to: pane)`

**Type + Enter (default):** `server.run(text, in: pane)` (sugar for
`sendKeys([text, "Enter"], to: pane)`)

**How "literal" is chosen:** `literally: true` option on `sendKeys`

### Examples

**Rust's `send_keys` always sends literal text.** Use `send_key_names` for tmux
key names. Passing `"Enter"` to `send_keys` types those characters; it does not
press the key.

**Text and Enter can be separate commands.** Python, TypeScript, Go, and .NET
normally send Enter after the text. If the second operation fails, the text may
already be in the pane; retrying the entire request can duplicate it. C++'s
separate `send_text` and `send_key("Enter")` calls have the same risk.

Rust's `send_line` and Java's `sendLine` append a literal `\r` to the text and
send it in one `send-keys -l` command. They avoid a separate Enter dispatch.

Send a command line and press Enter:

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
pane.send_keys("echo hi").await?; // Always literal text.
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
pane->send_key("Enter"); // separate command: no combined convenience exists
```

```swift
try await server.sendKeys(["echo hi"], to: pane) // no Enter
try await server.run("echo hi", in: pane)        // sugar for sendKeys([text, "Enter"])
```

## Reading a pane back

Capture methods return lines from the pane's visible screen by default:
`pane.capture_pane()` in Python, `pane.capture()` in TypeScript, Rust, Java, and
C++, `pane.Capture(ctx, ...)` in Go, `CaptureAsync(...)` in .NET, and
`server.capture(pane)` in Swift. Request scrollback explicitly, such as with
Python's `start` and `end` or Swift's `includingHistory`.

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

A send call completes when input reaches tmux. It does not wait for the shell
command to finish. Wait for expected output or a completion signal:

- **Python** can poll capture output for a marker. Its test-support module also
  provides `libtmux.test.retry_until(condition, ...)` for arbitrary conditions.
  [Waiting and retrying](../waiting-and-retry/) covers polling helpers across
  ports.
- **Swift** ships a real primitive for exactly this:
  `server.waitForOutput(...)` returns an `OutputWait` once a pattern shows
  up in the pane, rather than leaving you to write the loop.
- **Go** and **.NET** expose tmux's `wait-for` signal channel through
  `server.WaitFor(ctx, WaitForRequest{...})` and `TmuxWaitChannel`. Use a named
  signal when you control the command and can make it announce completion.

[Capture pane output](/examples/capture-pane-output/) has the checked,
per-port code for the polling-with-a-marker version of this; reach for a
port's native wait primitive above it where one exists.
