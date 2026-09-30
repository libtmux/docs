---
port: cxx
route: guides/getting-started
title: Getting started
description: Run a complete program with this language library.
sidebar:
  label: Getting started
  group: Guides
  order: 2
tableOfContents: true
---

Use `libtmux` to create sessions, send input and read pane output from C++.
The [complete capture program](../../examples/capture-pane-output/) includes
imports, its entry point, project files, dependency setup and a run command.

## Run the smallest thing that proves it works

Open that example in an empty directory and save the files using their displayed
names. Its setup pins the library revision that was used to execute the program.
It needs tmux on `PATH` and the native tools named on the example page.

The program creates a private server, sends a command, waits for the complete
line `libtmux capture ready`, then cleans up. A timeout or command failure is
reported. It does not need an existing tmux session.

## What just happened

`Pane::capture` returns captured text through a result that must be checked.
The complete program splits that text into lines and compares a whole line
before its deadline. Capture options select history and bound the output size;
an exceeded output limit is reported as an error.

## Connect to an existing server

Use the [complete attach program](../attaching-to-tmux/) to select an existing
socket and find the `work` session. That example leaves tmux running; its
launcher owns setup and cleanup for trying it safely.

## Where to go next

[Sending keys](../sending-keys/) explains input, and
[Capturing output](../capturing-output/) explains completion.
[Querying and filtering](../querying-and-filtering/) selects a target.
