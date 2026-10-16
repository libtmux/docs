---
port: go
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

```go file="examples/quickstart/main.go"
```

## Finding an existing session instead

For a script that runs repeatedly, look up a session before creating it.
[Attaching to
tmux](/guides/attaching-to-tmux/#finding-a-session-instead-of-always-creating-one)
shows that pattern, and [Filtering and querying, in
practice](/guides/querying-and-filtering/) covers absent and ambiguous matches.

## Where this comes from

**Source:** `examples/quickstart/main.go`

**In this page:** read whole from the file

**Checked by:** the whole file runs against a real tmux server as
`TestQuickstart`; the `docs:quickstart` region inside it is additionally
mirrored into README.md by `go generate ./tmux`, and CI fails if the two drift

### Source inclusion

A `file="..."` fence reads the named source during the site build. Hand-quoted
excerpts are copies; their source files and regions are listed above.
