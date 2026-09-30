---
port: py
route: guides/sending-keys
title: Sending keys
description: Send text and named keys, then wait for the result.
sidebar:
  label: Sending keys
  group: Guides
  order: 4
tableOfContents: true
---

`Pane.send_keys` accepts literal text with `literal=True`. It sends Enter by
default; use `enter=False` to type without submitting, then call `Pane.enter`.
The complete example sets literal mode explicitly.

## Run the complete program

[Capture pane output](../../examples/capture-pane-output/) supplies the full
Python program, imports, project setup and run command. It starts a private
server, sends a command, checks a complete output line and cleans up.

## Literal text, key names, and whether Enter follows

Choose the method and options for the input you mean to send. Literal text
still goes to an application: a shell interprets its quoting, expansions and
commands. Key-name handling and shell interpretation are separate concerns.

## The race you can't see from the call site

A successful send means tmux accepted input. The pane's program may still be
starting or processing that input. Wait for the state the next operation needs.
Terminal echo alone does not prove command completion.

`Pane.capture_pane` returns a list of lines. The complete program compares
whole lines, uses a monotonic deadline and closes its private server in
`finally`. The echoed shell command cannot satisfy its output check.

## Where to go next

[Capturing output](../capturing-output/) covers the output side.
[Attaching to tmux](../attaching-to-tmux/) connects to a server you already own.
