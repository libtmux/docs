---
port: ts
route: guides/sending-keys
title: Sending keys
description: Send text and named keys, then wait for the result.
sidebar:
  label: Sending keys
  group: Guides
  order: 4
tableOfContents: true
---

`Pane.sendKeys` sends Enter by default. Use `enter: false` to type without
submitting and `literal: true` when characters could be interpreted as key
names. Pass an abort signal to bound the operation.

## Run the complete program

[Capture pane output](../../examples/capture-pane-output/) supplies the full
TypeScript program, imports, project setup and run command. It starts a private
server, sends a command, checks a complete output line and cleans up.

## Literal text, key names, and whether Enter follows

Choose the method and options for the input you mean to send. Literal text
still goes to an application: a shell interprets its quoting, expansions and
commands. Key-name handling and shell interpretation are separate concerns.

## The race you can't see from the call site

A successful send means tmux accepted input. The pane's program may still be
starting or processing that input. Wait for the state the next operation needs.
Terminal echo alone does not prove command completion.

`Pane.capture` returns captured lines. The complete program uses
[`AbortSignal.timeout`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static) for a deadline and matches a whole output line.
Its cleanup checks whether the private socket exists, including when startup
fails, and reports shutdown errors.

## Where to go next

[Capturing output](../capturing-output/) covers the output side.
[Attaching to tmux](../attaching-to-tmux/) connects to a server you already own.
