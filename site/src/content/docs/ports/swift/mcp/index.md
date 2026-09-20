---
title: MCP for Swift
description: Run the Swift MCP executable or embed its typed tool service with explicit authority.
port: swift
product: mcp
sidebar:
  label: Overview
  order: 0
---

`libtmux-mcp` is the Swift stdio executable.
[`LibTmuxMCP`](https://github.com/libtmux/libtmux-swift/blob/254f8b2be7eb60cacc3ffcb3ea8e456784f582df/Package.swift)
is the SwiftPM library product for embedding the same
tools. They expose tmux discovery, captures, waits, input, configuration,
and process control.

The package requires Swift 6.2 or newer and supports Linux and macOS.
The documented Darwin dependency build uses Xcode's Swift 6.3 toolchain.
tmux is required at runtime.

## Start here

- [Install](#install) points an MCP client at this server.
- [Tools](./tools/) lists the MCP operations, arguments, and results.
- [Guides](./guides/) build the executable and configure its environment.
- [Topics](./topics/) explain toolsets, command waits, and capability discovery.
- [Examples](./examples/) call a tool, then explore server internals.
- [Language API](./reference/) documents embedding and implementation types.

The executable defaults to inspection, management, and execution; a
verified dedicated daemon can also receive teardown tools. The embedding
initializer defaults to inspection alone. Read `tmux://capabilities`
for the startup selection.

[Workspace Manager](../workspace/) is a separate library product. The
current MCP catalog does not include a workspace-file operation.

[Library contract](https://github.com/libtmux/libtmux-swift/blob/254f8b2be7eb60cacc3ffcb3ea8e456784f582df/Sources/LibTmuxMCP/README.md)
and [platform requirements](https://github.com/libtmux/libtmux-swift/blob/254f8b2be7eb60cacc3ffcb3ea8e456784f582df/README.md#requirements).
