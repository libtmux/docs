---
port: rs
route: guides/sending-keys
title: Sending keys
description: Send text and named keys, then wait for the result.
sidebar:
  label: Sending keys
  group: Guides
  order: 4
tableOfContents: true
---

`Pane::send_keys` sends literal text without Enter. `Pane::send_line` sends a
line and Enter in one dispatch. Use `Pane::send_key_names` for named keys.
Await the result and propagate a failed send before attempting the next step.

## Run the complete program

[Capture pane output](../../examples/capture-pane-output/) supplies the full
Rust program, imports, project setup and run command. It starts a private
server, sends a command, checks a complete output line and cleans up.

## Literal text, key names, and whether Enter follows

Choose the method and options for the input you mean to send. Literal text
still goes to an application: a shell interprets its quoting, expansions and
commands. Key-name handling and shell interpretation are separate concerns.

## The race you can't see from the call site

A successful send means tmux accepted input. The pane's program may still be
starting or processing that input. Wait for the state the next operation needs.
Terminal echo alone does not prove command completion.

`Pane::capture` reads the visible screen. The complete program compares the
returned line bytes with the expected output and uses [`tokio::time::timeout`](https://docs.rs/tokio/latest/tokio/time/fn.timeout.html)
to bound the task. It kills its private server and shuts down the client before
returning a capture error.

## Where to go next

[Capturing output](../capturing-output/) covers the output side.
[Attaching to tmux](../attaching-to-tmux/) connects to a server you already own.
