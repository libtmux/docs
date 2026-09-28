---
title: Kotlin examples
description: Tested Kotlin examples against an isolated tmux server.
port: kotlin
route: examples
sidebar:
  group: Examples
---

Read pushed pane output as a coroutine Flow and cancel a pending wait. The complete program belongs to the Java repository's examples module; that module also supplies `WatchPaneOutput`, and its test starts an isolated tmux server before calling this program's `main`. Run `./gradlew :examples:test` from that repository.

```kotlin file="examples/src/main/kotlin/io/github/libtmux/examples/WatchWithFlow.kt"
```
