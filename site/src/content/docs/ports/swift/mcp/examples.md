---
title: Swift MCP examples
description: List sessions through the Swift MCP server and inspect implementation examples.
port: swift
product: mcp
sidebar:
  label: Examples
  order: 3
---

Connect the server using the [setup guide](../guides/), then call
[`list_sessions`](../tools/list_sessions/) from your MCP client.

## List sessions

This is the `params` object for an MCP `tools/call` request. Send it
through the connected client:

```json
{
  "name": "list_sessions",
  "arguments": {}
}
```

Use the returned session IDs when choosing a window or pane. The
[tool reference](../tools/list_sessions/) describes this port's result
and optional arguments.

## Internals

The following examples are for applications that embed or extend the server.
Installing and connecting an MCP client does not require this code.

The Swift example package uses the public
[`LibTmuxMCP`](https://github.com/libtmux/libtmux-swift/blob/f02a4668570e1cc5198c941413750e021f42c214/Package.swift)
product directly.
It demonstrates the default readonly surface and an exact typed
selection without launching a stdio subprocess.

### Embed the tool surface

```swift file="Examples/Sources/ExampleCode/MCPEmbedding.swift"
```

The first function lists visible definitions and calls `list_panes`.
The caller supplies the existing `Server` and retains its lifetime.
The second function permits only the named operations within the mutating
tier; it does not include other future tools automatically.

### Run its tests

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

Use [Workspace builder examples](../../workspace/internals/examples/) for direct
workspace construction. A protocol client can perform that task through
`apply_workspace`, using the [tool reference](../tools/) for its schema.
