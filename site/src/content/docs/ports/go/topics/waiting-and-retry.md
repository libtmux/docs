---
port: go
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

**Helper:** `tmuxtest.WaitFor(ctx, interval, condition)`

**Where it lives:** `tmuxtest`, a separate test-support package from `tmux`

### Examples

`tmuxtest.WaitFor` probes immediately, then at the requested positive interval.
It returns a probe error or context error unchanged. Each probe must read fresh
state and honor its context. `Session.Windows()` only reads a stored snapshot;
use `Session.SearchWindows` to query tmux on every probe.

```go
waitCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
defer cancel()
err := tmuxtest.WaitFor(waitCtx, 50*time.Millisecond, func(ctx context.Context) (bool, error) {
	windows, err := session.SearchWindows(ctx, nil)
	if err != nil {
		return false, err
	}
	for _, w := range windows {
		if name, ok := w.Name(); ok && name == "build" {
			return true, nil
		}
	}
	return false, nil
})
if err != nil {
    return fmt.Errorf("wait for build window: %w", err)
}
```

## tmux's own wait-for channel

Use `tmux wait-for -S <channel>` to signal and `tmux wait-for <channel>` to
block until signalled. This avoids repeated screen captures when the command can
announce its own completion:

Call `Server.WaitFor` with a `WaitForRequest`. Set its mode to
`WaitForModeSignal` to signal the channel; the zero-value mode waits.

```go
if err := server.WaitFor(ctx, tmux.WaitForRequest{
    Channel: "built", Mode: tmux.WaitForModeSignal,
}); err != nil {
    return err
}
if err := server.WaitFor(ctx, tmux.WaitForRequest{Channel: "built"}); err != nil {
    return err
}
```

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
