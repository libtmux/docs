---
port: ts
route: topics/waiting-and-retry
title: Waiting and retrying
description: Polling a condition instead of guessing a sleep, and tmux's own wait-for signal channel as the alternative to polling.
sidebar:
  label: Waiting and retrying
  group: Topics
  order: 8
tableOfContents: true
---

After sending input or starting a process, wait for the state your next step
requires. [Pane
interaction](../pane-interaction/#waiting-for-something-to-finish) covers
waiting for screen text. This page covers arbitrary conditions and tmux's named
`wait-for` signal channels.

## Polling a condition

Polling checks a condition repeatedly until it succeeds or a deadline expires.
Set a deadline and choose an interval that limits unnecessary tmux commands.

**Helper:** `connectedServer.waitFor(matches, options)`

**Where it lives:** The public control-connection API. Tests a predicate over
`ServerSnapshot`; see [Control mode vs one-shot](/concepts/transports/).

### Examples

`waitFor` subscribes before reading a server snapshot so it does not miss a
change between those steps.

```typescript
await using live = await server.connect();
await live.waitFor((snapshot) => snapshot.windows.exists({ name: "build" }));
```

## tmux's own wait-for channel

Use `tmux wait-for -S <channel>` to signal and `tmux wait-for <channel>` to
block until signalled. This avoids repeated screen captures when the command can
announce its own completion:

The public API does not expose the channel handshake used internally
by the test server during startup.

tmux remembers a signal sent before a waiter starts. The next wait on that
channel returns immediately, so completion is not lost when the command finishes
first.

A raw `wait-for` client can exit zero when the server dies, as well as when the
channel is signalled. Verify server liveness when a lost server must be treated
as a failed task.

Use a channel name specific to the task. A remembered signal can otherwise
satisfy an unrelated later wait.

<details>
<summary>tmux manual and source</summary>

The tmux manual describes [completion channels](https://github.com/tmux/tmux/blob/94796f6b1182507efac8a272fc309a79e22e58a5/tmux.1#L8715).
The [channel implementation](https://github.com/tmux/tmux/blob/94796f6b1182507efac8a272fc309a79e22e58a5/cmd-wait-for.c#L388)
retains an early signal until a waiter consumes it. Use a fresh channel name
for each operation.

</details>
