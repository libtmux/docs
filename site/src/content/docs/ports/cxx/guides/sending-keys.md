---
port: cxx
route: guides/sending-keys
title: Sending keys
description: Send text and named keys, then wait for the result.
sidebar:
  label: Sending keys
  group: Guides
  order: 4
tableOfContents: true
---

`Pane::send_text` sends literal characters without an added newline.
`Pane::send_key` sends a named key such as Enter; `Pane::send_line` sends a
complete line. Check each result before proceeding. A failed operation carries
its diagnostic in the error value.

## Run the complete program

[Capture pane output](../../examples/capture-pane-output/) supplies the full
C++ program, imports, project setup and run command. It starts a private
server, sends a command, checks a complete output line and cleans up.

## Literal text, key names, and whether Enter follows

Choose the method and options for the input you mean to send. Literal text
still goes to an application: a shell interprets its quoting, expansions and
commands. Key-name handling and shell interpretation are separate concerns.

## The race you can't see from the call site

A successful send means tmux accepted input. The pane's program may still be
starting or processing that input. Wait for the state the next operation needs.
Terminal echo alone does not prove command completion.

`Pane::capture` returns captured text through a result that must be checked.
The complete program splits that text into lines and compares a whole line
before its deadline. Capture options select history and bound the output size;
an exceeded output limit is reported as an error.

## Where to go next

[Capturing output](../capturing-output/) covers the output side.
[Attaching to tmux](../attaching-to-tmux/) connects to a server you already own.
