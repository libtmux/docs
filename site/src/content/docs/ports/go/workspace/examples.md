---
title: "Go workspace examples"
description: "Executable examples for parsing, building, and retaining a session connection."
port: go
product: workspace
sidebar:
  label: Examples
  order: 3
tableOfContents: true
---

These Go examples build a workspace on dedicated sockets and check their
printed results with `// Output:` assertions. Each example creates a deadline
and tears down its own server with an independent cleanup deadline.

## Build a session

`Example` parses YAML, builds the session, and searches its resulting windows.
`ExampleBuildInto` creates the initial session connection explicitly and
populates it through `BuildInto`. The final example checks an unknown field.

```go file="workspace/example_test.go"
```

Use the connection-owning example when you want to keep a transport available
for later operations. Use `Build` when construction should manage its own
temporary connection and return a normal session handle.

## Verification

From the workspace module in a prepared source checkout, run:

```console
$ go test -run Example .
```

Go's example runner executes these functions and compares their output with
the comments. tmux must be on the host. The page reads the source file during
the site build; that inclusion does not itself run the examples.

The names in these examples select dedicated servers. Avoid reusing those
socket names for unrelated work because the cleanup stops their servers.

[Example source](https://github.com/libtmux/libtmux-go/blob/5f808882015a975a65acc7f9da5b3ff0d5cbdc91/workspace/example_test.go)
