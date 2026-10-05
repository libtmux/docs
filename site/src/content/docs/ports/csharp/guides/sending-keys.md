---
port: csharp
route: guides/sending-keys
title: Sending keys
description: Send text and named keys, then wait for the result.
sidebar:
  label: Sending keys
  group: Guides
  order: 4
tableOfContents: true
---

`Pane.SendTextAsync` sends text; `Pane.EnterAsync` submits the line. Pass a
cancellation token to both operations. The complete program performs these
steps separately and waits for its output before treating the task as done.

## Run the complete program

[Capture pane output](../../examples/capture-pane-output/) supplies the full
C# program, imports, project setup and run command. It starts a private
server, sends a command, checks a complete output line and cleans up.

## Literal text, key names, and whether Enter follows

Choose the method and options for the input you mean to send. Literal text
still goes to an application: a shell interprets its quoting, expansions and
commands. Key-name handling and shell interpretation are separate concerns.

## The race you can't see from the call site

A successful send means tmux accepted input. The pane's program may still be
starting or processing that input. Wait for the state the next operation needs.
Terminal echo alone does not prove command completion.

`Pane.CaptureAsync` reads visible pane lines. The complete program passes a
cancellation token, compares whole lines and bounds its waits with a
[`CancellationTokenSource`](https://learn.microsoft.com/en-us/dotnet/api/system.threading.cancellationtokensource?view=net-10.0). Its `OwnedServerScope` owns the private server and
is disposed with `await using`.

## Where to go next

[Capturing output](../capturing-output/) covers the output side.
[Attaching to tmux](../attaching-to-tmux/) connects to a server you already own.
