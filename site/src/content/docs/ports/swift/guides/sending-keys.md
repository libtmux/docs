---
port: swift
route: guides/sending-keys
title: Sending keys
description: Send text and named keys, then wait for the result.
sidebar:
  label: Sending keys
  group: Guides
  order: 4
tableOfContents: true
---

`Server.run(_:in:)` types a command line and presses Enter. Await it with
`try await`, then wait separately for the output your next operation needs.
The complete program uses an explicit socket and propagates failed operations.

## Run the complete program

[Capture pane output](../../examples/capture-pane-output/) supplies the full
Swift program, imports, project setup and run command. It starts a private
server, sends a command, checks a complete output line and cleans up.

## Literal text, key names, and whether Enter follows

Choose the method and options for the input you mean to send. Literal text
still goes to an application: a shell interprets its quoting, expansions and
commands. Key-name handling and shell interpretation are separate concerns.

## The race you can't see from the call site

A successful send means tmux accepted input. The pane's program may still be
starting or processing that input. Wait for the state the next operation needs.
Terminal echo alone does not prove command completion.

`Server.capture` reads pane lines. The complete program compares a whole line,
bounds the wait and reports cleanup errors. For repeated reads of changing
output, the streaming APIs can track output beyond one screen snapshot;
consult this version's API reference for their lifetime and completion rules.

## Where to go next

[Capturing output](../capturing-output/) covers the output side.
[Attaching to tmux](../attaching-to-tmux/) connects to a server you already own.
