---
supportedPorts: [py, ts, rs, go, java, csharp, cxx, swift]
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
output](/guides/capturing-output/) are task guides; this page covers input
defaults, capture ranges, and completion handling.

## Typing into a pane

Two questions come up every time you send something to a pane: should tmux
press Enter afterward, and should tmux interpret what you sent as key names
(`Enter`, `C-c`) rather than literal characters? Choose both explicitly when
a command depends on them.

<!-- port:py -->
<!-- port:root -->
### Python
<!-- /port -->

**Type without Enter:** `pane.send_keys(text, enter=False)`

**Type + Enter (default):** `pane.send_keys(text)`

**How "literal" is chosen:** `literal=True` flag on the same method

<!-- /port -->

<!-- port:ts -->
<!-- port:root -->
### TypeScript
<!-- /port -->

**Type without Enter:** `pane.sendKeys(text, { enter: false })`

**Type + Enter (default):** `pane.sendKeys(text)`

**How "literal" is chosen:** `{ literal: true }` option

<!-- /port -->

<!-- port:go -->
<!-- port:root -->
### Go
<!-- /port -->

**Type without Enter:** `pane.SendKeys(ctx, SendKeysRequest{Command: &text,
SkipEnter: true})`

**Type + Enter (default):** `pane.SendKeys(ctx, SendKeysRequest{Command:
&text})`

**How "literal" is chosen:** `Literal: true` field

<!-- /port -->

<!-- port:rs -->
<!-- port:root -->
### Rust
<!-- /port -->

**Type without Enter:** `pane.send_keys(keys)`: **always literal**, key names
typed as text

**Type + Enter (default):** `pane.send_line(text)`

**How "literal" is chosen:** `send_keys` sends literal text; `send_key_names`
interprets tmux key names.

<!-- /port -->

<!-- port:java -->
<!-- port:root -->
### Java
<!-- /port -->

**Type without Enter:** `pane.send(keys)`

**Type + Enter (default):** `pane.sendLine(command)`

**How "literal" is chosen:** Separate text and key-sending methods.

<!-- /port -->

<!-- port:csharp -->
<!-- port:root -->
### C#
<!-- /port -->

**Type without Enter:** `SendKeysAsync(new SendKeysRequest(text, enter: false))`

**Type + Enter (default):** `SendTextAsync(text)` (defaults `enter: true`)

**How "literal" is chosen:** `SendKeysRequest.Literal` field;
`SendTextAsync` hardcodes it

<!-- /port -->

<!-- port:cxx -->
<!-- port:root -->
### C++
<!-- /port -->

**Type without Enter:** `pane->send_text(text)`

**Type + Enter:** `pane->send_text(text)` then `pane->send_key("Enter")`
separately: no combined convenience exists

**How "literal" is chosen:** `send_text` is always literal; `send_key` is always
a key name

<!-- /port -->

<!-- port:swift -->
<!-- port:root -->
### Swift
<!-- /port -->

**Type without Enter:** `server.sendKeys([text], to: pane)`

**Type + Enter (default):** `server.run(text, in: pane)` (sugar for
`sendKeys([text, "Enter"], to: pane)`)

**How "literal" is chosen:** `literally: true` option on `sendKeys`

<!-- /port -->

### Examples

<!-- port:rs -->
`send_keys` sends literal text. Use `send_key_names` for tmux key names.
Passing `"Enter"` to `send_keys` types those characters. `send_line` appends a
carriage return and delivers it with the text in one tmux command.
<!-- /port -->

<!-- port:java -->
`sendLine` appends a carriage return and delivers it with the text in one tmux
command.
<!-- /port -->

<!-- port:py,ts,go,csharp,cxx -->
Text and Enter can be separate tmux commands. If the second operation fails,
the text may already be in the pane. Check the current state before retrying;
repeating the whole request can duplicate input.
<!-- /port -->

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
text := "printf 'hello\\n'"
if err := pane.SendKeys(ctx, tmux.SendKeysRequest{
    Command: &text,
    Literal: true,
}); err != nil {
    return fmt.Errorf("send command: %w", err)
}
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
// no Enter
try await server.sendKeys(["echo hi"], to: pane)
// sugar for sendKeys([text, "Enter"])
try await server.run("echo hi", in: pane)
```

## Reading a pane back

Capture reads the pane's visible screen by default. Request scrollback when
you need earlier output. A capture is a snapshot of terminal contents, including
any input echoed by the application.

<!-- port:go -->
`pane.Capture` returns `([]string, error)`. Pass a `context.Context` with a
deadline and check the error before using the result. Set the start boundary to
`tmux.CaptureBoundary` to include scrollback. `End: tmux.CaptureBoundary`
includes the bottom of the visible pane.
<!-- /port -->

```python
pane.capture_pane()
```

```typescript
await pane.capture();
```

```go
lines, err := pane.Capture(ctx, tmux.CapturePaneRequest{})
if err != nil {
    return fmt.Errorf("capture pane: %w", err)
}
for _, line := range lines {
    fmt.Println(line)
}
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
command to finish. Wait for expected output or a completion signal.

<!-- port:py -->
Poll capture output for a marker or use the `wait_for` signal channel when you
control the command. The test-support module provides
`libtmux.test.retry_until(condition, ...)` for arbitrary conditions.
<!-- /port -->

<!-- port:swift -->
`server.waitForOutput(...)` waits for a pattern in pane output and returns an
`OutputWait`. Give the wait a timeout.
<!-- /port -->

<!-- port:go -->
Use `server.WaitFor` with a `WaitForRequest` when the command can signal tmux's
`wait-for` channel. For streaming output, open `pane.OpenObservation(ctx)`
before sending input so the observation includes the command's first bytes.
Both paths take a context; cancellation bounds how long the caller waits.

For a new command whose exit status matters, use `session.Run` and inspect its
result. Capturing screen text alone cannot establish the command's exit status.
<!-- /port -->

<!-- port:csharp -->
Use `TmuxWaitChannel` when the command can signal a named tmux `wait-for`
channel. Use a cancellation token to bound the wait.
<!-- /port -->

[Capture pane output](/examples/capture-pane-output/) shows capture and waiting
examples. [Waiting and retrying](../waiting-and-retry/) explains completion
conditions and timeouts.

<details>
<summary>tmux manual and source</summary>

The tmux manual defines [key-name and literal input](https://github.com/tmux/tmux/blob/94796f6b1182507efac8a272fc309a79e22e58a5/tmux.1#L4457)
and [screen and history capture](https://github.com/tmux/tmux/blob/94796f6b1182507efac8a272fc309a79e22e58a5/tmux.1#L2798).
A send operation delivers input; it does not establish the program's exit status.

</details>
