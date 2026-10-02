---
port: java
route: guides/testing-with-libtmux
title: Testing with libtmux
description: Use an isolated server and check cleanup failures.
sidebar:
  label: Testing with libtmux
  group: Guides
  order: 7
tableOfContents: true
---

`libtmux-junit5` supplies a `TmuxExtension` and a running `Server` for each test.
Request a `TmuxSocketPath` when the code under test accepts a path instead.
For a standalone executable, the complete capture program demonstrates
explicit `ServerConfig` setup, output assertions and cleanup.

<a id="java-docs-tests"></a>

The port's `docs` module compiles Java fences from READMEs and guides, then runs
them against `libtmux-junit5` servers. A `<!-- snippet: ... -->` directive can
instead require a named exception, a compile failure, or an explicit skip reason.
Source: `docs/README.md`.

A setup added by a test fixture is still needed when copying a fragment into a
new project; the linked program includes all imports and its entry point.

## Run a complete example

[Capture pane output](../../examples/capture-pane-output/) includes a complete
Java executable, imports, dependency setup and cleanup. Its output check fails
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
