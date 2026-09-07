---
title: Swift MCP examples
description: Embed TmuxTools and choose exact typed tool authority using tested source examples.
port: swift
product: mcp
sidebar:
  label: Examples
  order: 3
---

The Swift example package uses the public `LibTmuxMCP` product directly.
It demonstrates the default readonly surface and an exact typed
selection without launching a stdio subprocess.

## Embed the tool surface

```swift file="Examples/Sources/ExampleCode/MCPEmbedding.swift"
```

The first function lists visible definitions and calls `list_panes`.
The caller supplies the existing `Server` and retains its lifetime.
The second function permits only the named operations within the mutating
tier; it does not include other future tools automatically.

## Run its tests

From the Swift repository with its toolchain and tmux installed:

```console
$ swift test \
    --package-path Examples \
    --filter MCPEmbeddingTests
```

The [example tests](https://github.com/libtmux/libtmux-swift/blob/f02a4668570e1cc5198c941413750e021f42c214/Examples/Tests/ExampleTests/MCPEmbeddingTests.swift)
use a tmux fixture to verify the pane count and exact offered names.
Rendering the source does not run that test.

The [example source](https://github.com/libtmux/libtmux-swift/blob/f02a4668570e1cc5198c941413750e021f42c214/Examples/Sources/ExampleCode/MCPEmbedding.swift)
is also the basis for the library's embedding documentation.

Use [Workspace Manager examples](../../workspace/examples/) for direct
workspace construction. A protocol client can perform that task through
`apply_workspace`, using the [tool reference](../tools/) for its schema.
