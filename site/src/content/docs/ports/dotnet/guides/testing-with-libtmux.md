---
port: dotnet
route: guides/testing-with-libtmux
title: Testing with libtmux
description: Use an isolated server and check cleanup failures.
sidebar:
  label: Testing with libtmux
  group: Guides
  order: 7
tableOfContents: true
---

`LibTmux.Testing` is a separate package. `TmuxTestFactory` creates a temporary
hierarchy whose scope is disposed with `await using`. Use a bounded predicate
wait for state assertions. The complete capture program shows ownership with
`Server.CreateOwnedAsync` and a cancellation token in a standalone executable.

## Run a complete example

[Capture pane output](../../examples/capture-pane-output/) includes a complete
.NET executable, imports, dependency setup and cleanup. Its output check fails
when the expected line does not arrive before the deadline. Start with that
program when adapting the pattern to your own test runner.

## Keep server ownership explicit

Give each test a private socket and a known tmux configuration. Stop the server
the test creates, including when startup or an assertion fails. Preserve the
original failure and report cleanup errors so a leaked server remains visible.

A connection to an existing server has a different lifetime. The
[attach program](../attaching-to-tmux/) leaves that server running and lets its
launcher own cleanup.

## Wait for the state you assert

Wait for the actual output or completion condition with a deadline.
[Sending keys](../sending-keys/) returning successfully does not establish
that the application finished. [Capturing output](../capturing-output/) explains
the difference between a screen snapshot and a stream of output.
