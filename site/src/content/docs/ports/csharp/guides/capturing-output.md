---
port: csharp
route: guides/capturing-output
title: Capturing output
description: Read pane output with an explicit completion condition.
sidebar:
  label: Capturing output
  group: Guides
  order: 5
tableOfContents: true
---

`Pane.CaptureAsync` reads visible pane lines. The complete program passes a
cancellation token, compares whole lines and bounds its waits with a
[`CancellationTokenSource`](https://learn.microsoft.com/en-us/dotnet/api/system.threading.cancellationtokensource?view=net-10.0). Its `OwnedServerScope` owns the private server and
is disposed with `await using`.

## Run the complete program

[Capture pane output](../../examples/capture-pane-output/) includes the full
C# program, all imports, project files and a run command. The program
matches `libtmux capture ready` as a complete line, so the echoed command cannot
satisfy the check. It creates and cleans up its own tmux server.

## Visible pane vs. scrollback

A capture reads terminal state. Lines that have scrolled beyond retained history
are unavailable, and repeated captures can miss intermediate output. Choose the
range your task needs and use a stream or completion signal when every output
event matters.

<a id="dont-poll-wait-for-the-text-instead"></a>

## Wait for the expected text

Use a deadline and a specific output predicate. The example's short polling
pause limits work between checks; it is the observed line that determines
completion. [Sending keys](../sending-keys/) explains why returning from the
input call is not a completion signal.

<a id="when-the-pane-can-announce-itself-wait-for-not-scraping"></a>

## Wait for a completion signal

A program can also signal a dedicated tmux channel. Use the same server endpoint
for the sender and waiter and a new channel name per task.
[Waiting and retrying](/topics/waiting-and-retry/) documents this port's waiting
APIs and failure handling.
