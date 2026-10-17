---
port: cxx
route: topics/pane-interaction
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
([`Enter`](/tmux/latest/manual/send-keys/), `C-c`) rather than literal characters? Choose both explicitly when
a command depends on them.

**Type without Enter:** `pane->send_text(text)`

**Type + Enter:** `pane->send_text(text)` then `pane->send_key("Enter")`
separately: no combined convenience exists

**How "literal" is chosen:** `send_text` is always literal; `send_key` is always
a key name

### Examples

Text and Enter can be separate tmux commands. If the second operation fails,
the text may already be in the pane. Check the current state before retrying;
repeating the whole request can duplicate input.

Send a command line and press Enter:

```cpp
pane->send_text("echo hi");
pane->send_key("Enter"); // separate command: no combined convenience exists
```

## Reading a pane back

Capture reads the pane's visible screen by default. Request scrollback when
you need earlier output. A capture is a snapshot of terminal contents, including
any input echoed by the application.

```cpp
pane->capture();
```

## Waiting for something to finish

A send call completes when input reaches tmux. It does not wait for the shell
command to finish. Wait for expected output or a completion signal.

[Capture pane output](/examples/capture-pane-output/) shows capture and waiting
examples. [Waiting and retrying](../waiting-and-retry/) explains completion
conditions and timeouts.

<details>
<summary>tmux manual and source</summary>

The tmux manual defines [key-name and literal input](https://github.com/tmux/tmux/blob/94796f6b1182507efac8a272fc309a79e22e58a5/tmux.1#L4457)
and [screen and history capture](https://github.com/tmux/tmux/blob/94796f6b1182507efac8a272fc309a79e22e58a5/tmux.1#L2798).
A send operation delivers input; it does not establish the program's exit status.

</details>
