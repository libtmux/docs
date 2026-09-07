---
title: Sending keys
description: Literal text versus tmux key names, whether Enter is pressed for you, and why a command can outrun the shell about to run it.
sidebar:
  label: Sending keys
  group: Guides
  order: 4
tableOfContents: true
---

Send literal text to type characters into a pane, or send tmux key names such as
`C-c`, `Enter`, and `Up` to press those keys. Check the method's literal-text
and Enter defaults: typing the word `Enter` and pressing Enter are different
operations.

## Literal text, key names, and whether Enter follows

These examples show each port's text, named-key, and Enter behavior. [Attach and
send keys](/examples/attach-and-send-keys/) provides the full source examples
and validation details.

```python
# literal=True disables tmux's key-name lookup; left at its default, a
# string that happens to look like a key name is interpreted as one.
pane.send_keys(cmd, literal=True)

# enter defaults to True. Pass enter=False to type without submitting, then
# press Enter yourself: the README's own example, to show the steps apart.
pane.send_keys('echo hey', enter=False)
pane.enter()
```

```typescript
// literal: true reads the text as characters even when it could be read as
// a tmux key name. sendKeys presses Enter unless you say otherwise.
await pane.sendKeys("q", { enter: false, literal: true });
```

```go
// Literal disables tmux key-name lookup and treats Command as literal
// UTF-8. It does not bypass interpretation by the pane's own shell.
err := pane.SendKeys(ctx, tmux.SendKeysRequest{Command: &cmd, Literal: true})

// A separate Enter follows Command unless SkipEnter is set.
err = pane.SendKeys(ctx, tmux.SendKeysRequest{Command: &cmd, SkipEnter: true})
```

```rust
// send_keys always sends with tmux's "-l" (literal) flag: key names such as
// C-c are typed rather than interpreted. It sends no Enter.
pane.send_keys("echo hey").await?;

// send_line sends literal text *and* Enter as one dispatch, so cancelling
// this future cannot leave a completed text send without its Enter.
pane.send_line("echo hey").await?;

// send_key_names takes actual key names, for when you mean the key.
pane.send_key_names(["C-c"]).await?;
```

```cpp
// Literal text, never interpreted as key names or formats, and never
// followed by a newline the caller did not ask for.
pane.send_text("echo hey");

// One named key, sent separately: this is how Enter gets pressed.
pane.send_key("Enter");
```

```csharp
await pane.SendTextAsync("echo hey", cancellationToken: ct);
await pane.EnterAsync(ct);
```

```java
// Sends the text and submits it as one call: no separate literal switch
// and no documented "type without submitting" step as of this page.
pane.sendLine("echo hey");
```

```swift
// One call: types the command line, then presses Enter. No literal switch
// and no separate "type, don't submit" step is exposed at this level.
try await server.run("echo hey", in: pane)
```

Check each method's input contract before sending text that could be a key name.
Some ports separate text and key-name methods; others use a literal-text flag.
[Concepts](/concepts/) introduces the shared tmux model.

## The race you can't see from the call site

Completing `send-keys` means tmux accepted the input. The shell may still be
starting, and the command may still be running. The port examples provide
different ways to wait:

- **Rust** uses a `retry_until` loop in the README's query example to wait for
  the shell.
- **Go** provides `tmuxtest.WaitForShellReady` for tests that need a ready
  shell.
- **.NET** demonstrates waiting for command output in the README's "Running
  something, and reading it back" section.

Wait for shell readiness before sending input when startup matters. Then wait
for the command's expected output or a completion signal before reading its
result. The next guide covers those waiting APIs.

## Where to go next

- [Capturing output](../capturing-output/): reading back what you just
  sent, and waiting for it correctly instead of guessing a delay.
- [Attach and send keys](/examples/attach-and-send-keys/): the full
  sourced round trip this guide picks apart piece by piece.
