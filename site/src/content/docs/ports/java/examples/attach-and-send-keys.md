---
port: java
route: examples/attach-and-send-keys
title: Attach and send keys
description: Get a session handle, send a command to a pane, and capture output.
sidebar:
  label: Attach and send keys
  group: Examples
  order: 2
tableOfContents: true
---

Get a session handle, send a command to a pane, and capture output. These
examples use libtmux from your program; to attach your terminal interactively,
see [Attaching to tmux](/guides/attaching-to-tmux/).

The examples include setup, error handling, and cleanup. [Source and
verification](#where-this-comes-from) identifies their files and checks.

```java file="examples/src/main/java/io/github/libtmux/examples/BuildAWorkspace.java"
```

## Finding an existing session instead

For a script that runs repeatedly, look up a session before creating it.
[Attaching to
tmux](/guides/attaching-to-tmux/#finding-a-session-instead-of-always-creating-one)
shows that pattern, and [Filtering and querying, in
practice](/guides/querying-and-filtering/) covers absent and ambiguous matches.

## Where this comes from

**Source:**
`examples/src/main/java/io/github/libtmux/examples/BuildAWorkspace.java`

**In this page:** read whole from the file

**Checked by:** run against real tmux by the `examples` module's own
`ExamplesRunTest`

### Source inclusion

A `file="..."` fence reads the named source during the site build. Hand-quoted
excerpts are copies; their source files and regions are listed above.
