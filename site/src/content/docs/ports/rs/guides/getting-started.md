---
port: rs
route: guides/getting-started
title: Getting started
description: Run a complete program with this language library.
sidebar:
  label: Getting started
  group: Guides
  order: 2
tableOfContents: true
---

Use `libtmux-tokio` to create sessions, send input, and read pane output from
an async Rust application. Import it as `libtmux_tokio` and await its I/O calls.
The [complete capture program](../../examples/capture-pane-output/) includes
imports, its entry point, project files, dependency setup and a run command.

For synchronous Rust, `libtmux` provides blocking handles without a runtime.
See [Standard-library core](../../concepts/standard-library-core/) for the
package choices and complete blocking examples. The split packages are
unreleased; use the pinned Git source shown in each example.

## Run the smallest thing that proves it works

Open that example in an empty directory and save the files using their displayed
names. Its setup pins the library revision used by the program.
It needs tmux on `PATH` and the native tools named on the example page.

The program creates a private server, sends a command, waits for the complete
line `libtmux capture ready`, then cleans up. A timeout or command failure is
reported. It does not need an existing tmux session.

## What just happened

[`Pane::capture`](../../reference/libtmux_tokio-pane-pane-capture/) reads the visible screen. The complete program compares the
returned line bytes with the expected output and uses [`tokio::time::timeout`](https://docs.rs/tokio/latest/tokio/time/fn.timeout.html)
to bound the task. It kills its private server and shuts down the client before
returning a capture error.

## Connect to an existing server

Use the [complete attach program](../attaching-to-tmux/) to select an existing
socket and find the `work` session. That example leaves tmux running; its
launcher owns setup and cleanup for trying it safely.

## Where to go next

[Sending keys](../sending-keys/) explains input, and
[Capturing output](../capturing-output/) explains completion.
[Querying and filtering](../querying-and-filtering/) selects a target.
