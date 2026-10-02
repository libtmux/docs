---
port: swift
route: guides/testing-with-libtmux
title: Testing with libtmux
description: Use an isolated server and check cleanup failures.
sidebar:
  label: Testing with libtmux
  group: Guides
  order: 7
tableOfContents: true
---

[TmuxFixture](https://github.com/libtmux/libtmux-swift/tree/254f8b2be7eb60cacc3ffcb3ea8e456784f582df/Tests/TmuxFixture)
is a separate package product. `withTmuxServer` supplies a
private server with a bootstrap session for the body of a test. Use a bounded
wait for output assertions. The complete capture program demonstrates explicit
server setup and cleanup outside a testing fixture.

## Run a complete example

[Capture pane output](../../examples/capture-pane-output/) includes a complete
Swift executable, imports, dependency setup and cleanup. Its output check fails
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
