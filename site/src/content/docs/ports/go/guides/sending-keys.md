---
port: go
route: guides/sending-keys
title: Sending keys
description: Send text and named keys, then wait for the result.
sidebar:
  label: Sending keys
  group: Guides
  order: 4
tableOfContents: true
---

Pass a `tmux.SendKeysRequest` to `Pane.SendKeys` and check the returned error.
Set `Literal` to send characters and `SkipEnter` to type without submitting.
`Pane.Enter` sends Enter separately. Use a context deadline for operations that
must finish within a fixed budget.

## Run the complete program

[Capture pane output](../../examples/capture-pane-output/) supplies the full
Go program, imports, project setup and run command. It starts a private
server, sends a command, checks a complete output line and cleans up.

## Literal text, key names, and whether Enter follows

Choose the method and options for the input you mean to send. Literal text
still goes to an application: a shell interprets its quoting, expansions and
commands. Key-name handling and shell interpretation are separate concerns.

## The race you can't see from the call site

A successful send means tmux accepted input. The pane's program may still be
starting or processing that input. Wait for the state the next operation needs.
Terminal echo alone does not prove command completion.

`Pane.Capture` takes a `tmux.CapturePaneRequest`. Use `Start` and `End` to choose
a range; `tmux.CaptureBoundary` reaches the corresponding history or screen
boundary. The complete program reads the visible screen, compares full lines
and stops when its context expires.

## Where to go next

[Capturing output](../capturing-output/) covers the output side.
[Attaching to tmux](../attaching-to-tmux/) connects to a server you already own.
