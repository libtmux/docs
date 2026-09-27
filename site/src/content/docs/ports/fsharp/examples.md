---
title: F# examples
description: Tested F# examples against an isolated tmux server.
port: fsharp
route: examples
sidebar:
  group: Examples
---

This complete program creates an isolated tmux server, captures its panes, and applies a portable filter. Both owned scopes close when the task completes. Follow the [package quickstart](../guides/quickstart/) to create an F# project and install LibTmux.FSharp, then use this as Program.fs.

```fsharp file="examples/LibTmux.FSharp.Quickstart/Program.fs"
```
