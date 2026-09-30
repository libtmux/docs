---
title: Scala examples
description: Tested Scala examples against an isolated tmux server.
port: scala
route: examples
sidebar:
  group: Examples
---

Start with [Capture pane output](./capture-pane-output/) for a standalone program with imports, Gradle files, and private-server cleanup.

## Create a workspace

Create a session with a split window, send text, wait for printed output, and query captured panes with the Scala facade. The examples module supplies `ExampleRuntime`. Its executable test passes an owned socket and checks that the original sessions and clients remain after this program exits. Run `./gradlew :examples:test` from the Java repository.

```scala file="examples/src/main/scala/io/github/libtmux/scaladsl/examples/BlockingWorkspace.scala"
```
