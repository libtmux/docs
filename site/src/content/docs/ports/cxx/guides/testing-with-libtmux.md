---
port: cxx
route: guides/testing-with-libtmux
title: Testing with libtmux
description: Use an isolated server and check cleanup failures.
sidebar:
  label: Testing with libtmux
  group: Guides
  order: 7
tableOfContents: true
---

The complete capture program uses `libtmux::test::ScopedTmuxServer` to own a
private server and report teardown failures. It includes the public testing
header and links the testing library explicitly in its CMake setup.

This fixture is temporary example scaffolding. In an application, use the
regular [`Server`](../../reference/libtmux-server/) connected to the server you
manage. Future versions of that example will use the regular server object
directly.

## Run a complete example

[Capture pane output](../../examples/capture-pane-output/) includes a complete
C++ executable, imports, dependency setup and cleanup. Its output check fails
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
