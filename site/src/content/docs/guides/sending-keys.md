---
title: Sending keys
description: Literal text versus tmux key names, whether Enter is pressed for you, and why a command can outrun the shell about to run it.
sidebar:
  label: Sending keys
  group: Guides
  order: 4
tableOfContents: true
---

Every port's version of `send_keys` is really `tmux send-keys` wearing that
port's calling convention, and `send-keys` has one behavior worth
understanding before you rely on it: **tmux can read the text you send
either as literal characters or as tmux's own key vocabulary** (`C-c`,
`Enter`, `Up`). Without a literal flag, `q` sent to a pane running `less` is
a keypress; the same `q` sent literally is the character `q`, which happens
to also quit `less` — so the ambiguity mostly hides until the text you're
sending collides with a real key name.

## Literal text, key names, and whether Enter follows

Each block below sends the same two things a port can send — text and,
separately, a named key — and shows whether pressing Enter is the default,
an option, or a second call you make yourself. Source citations sit as
comments in each block; see [Attach and send keys](/examples/attach-and-send-keys/)
for the same calls in their full, checked context.

```python
# literal=True disables tmux's key-name lookup; left at its default, a
# string that happens to look like a key name is interpreted as one.
pane.send_keys(cmd, literal=True)

# enter defaults to True. Pass enter=False to type without submitting, then
# press Enter yourself — the README's own example, to show the steps apart.
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

// One named key, sent separately — this is how Enter gets pressed.
pane.send_key("Enter");
```

```csharp
await pane.SendTextAsync("echo hey", cancellationToken: ct);
await pane.EnterAsync(ct);
```

```java
// Sends the text and submits it as one call — no separate literal switch
// and no documented "type without submitting" step as of this page.
pane.sendLine("echo hey");
```

```swift
// One call: types the command line, then presses Enter. No literal switch
// and no separate "type, don't submit" step is exposed at this level.
try await server.run("echo hey", in: pane)
```

Java, .NET, and Swift send exactly the text given, without a separate
literal switch to reach for — the type signature doesn't offer the
ambiguous path in the first place. Confirm against your own port's
reference before assuming a call is unambiguous for input that looks like a
key name (a literal `#` in an option value has this same class of gotcha —
see the option-naming note in [Concepts](/concepts/)).

## The race you can't see from the call site

tmux accepts a `send-keys` command the instant it's issued — before the
shell in that pane has necessarily started, and before whatever you sent
has necessarily finished. Two ports say this outright, and a third ships
the fix without spelling out the reason:

- **Rust**: "tmux hands back a pane the moment it forks, before the shell
  in it has started" — the comment sits directly above a `retry_until`
  loop in `README.md`'s query example.
- **Go**: doesn't say the same sentence, but ships the fix for it —
  `tmuxtest.WaitForShellReady` exists specifically for a pane that hasn't
  started its shell yet.
- **.NET**: "tmux accepts a command before the shell has finished it, so
  the result is waited for rather than assumed" — from `README.md`'s
  "Running something, and reading it back" section.

The fix in every case is the same shape: don't read a pane immediately
after sending to it; wait for the text you expect to actually appear. That
waiting mechanism — what each port offers instead of a fixed `sleep` — is
the subject of the next guide.

## Where to go next

- [Capturing output](../capturing-output/) — reading back what you just
  sent, and waiting for it correctly instead of guessing a delay.
- [Attach and send keys](/examples/attach-and-send-keys/) — the full
  sourced round trip this guide picks apart piece by piece.
