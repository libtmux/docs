---
title: "Build a Go workspace"
description: "Install the workspace module and create or populate a tmux session."
port: go
product: workspace
sidebar:
  label: Guides
  order: 2
tableOfContents: true
---

Use `Parse` to validate YAML, then `Build` to create the described session.
Start in a Go module and add the workspace dependency:

```console
$ go get github.com/libtmux/libtmux-go/workspace
```

Pin the resolved version in your module files. The module's current source
requires Go 1.26 and uses a separate core libtmux dependency. tmux must be
available for construction.

## Parse before building

The [executable examples](../examples/) provide a complete program-shaped test
with imports, a deadline, a dedicated socket, and cleanup. Its central calls
are `workspace.Parse(document)` followed by
`workspace.Build(ctx, server, described)`.

Save a description like this as `project.yaml`:

```yaml
session_name: project
windows:
  - window_name: editor
    panes:
      - shell_command: echo ready
  - window_name: tests
    panes:
      - shell_command: echo ready
```

Read the file with `os.ReadFile` and handle that error before parsing. Handle
parse errors before opening a server. If a build fails, retain its returned
session handle long enough to inspect or clean up any partial result.

## Retain a connection

Choose `BuildInto` when the application already owns a session connection.
Call `described.InitialSessionRequest`, create a session connection with that
request, then pass its session to `BuildInto`. Close the connection when the
caller is done; the workspace function does not transfer ownership.

## Inspect the result

Use `SearchWindows` or a fresh server snapshot to inspect membership. Do not
expect the handle returned by a creation call to contain populated relations.
Review missing working directories before building if falling back to the
home directory would make the workspace run in the wrong location.

[Complete build examples](https://github.com/libtmux/libtmux-go/blob/5f808882015a975a65acc7f9da5b3ff0d5cbdc91/workspace/example_test.go); [Module requirements](https://github.com/libtmux/libtmux-go/blob/5f808882015a975a65acc7f9da5b3ff0d5cbdc91/workspace/go.mod).
