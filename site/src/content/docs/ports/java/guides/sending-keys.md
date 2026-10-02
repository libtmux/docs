---
port: java
route: guides/sending-keys
title: Sending keys
description: Send text and named keys, then wait for the result.
sidebar:
  label: Sending keys
  group: Guides
  order: 4
tableOfContents: true
---

`Pane.sendLine` sends a command line and submits it. The complete program
checks the resulting output separately; a successful send does not establish
that the shell finished. Configure a timeout through `ServerConfig` and keep
exceptions visible.

## Run the complete program

[Capture pane output](../../examples/capture-pane-output/) supplies the full
Java program, imports, project setup and run command. It starts a private
server, sends a command, checks a complete output line and cleans up.

## Literal text, key names, and whether Enter follows

Choose the method and options for the input you mean to send. Literal text
still goes to an application: a shell interprets its quoting, expansions and
commands. Key-name handling and shell interpretation are separate concerns.

## The race you can't see from the call site

A successful send means tmux accepted input. The pane's program may still be
starting or processing that input. Wait for the state the next operation needs.
Terminal echo alone does not prove command completion.

`Pane.capture` returns visible pane contents as a list of lines. The complete
program compares a full line with its expected value and checks a monotonic
deadline. A `finally` block kills its private tmux server, while
try-with-resources closes the `Server` handle.

## Where to go next

[Capturing output](../capturing-output/) covers the output side.
[Attaching to tmux](../attaching-to-tmux/) connects to a server you already own.
