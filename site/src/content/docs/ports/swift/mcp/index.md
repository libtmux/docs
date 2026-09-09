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
[`LibTmuxMCP`](https://github.com/libtmux/libtmux-swift/blob/f02a4668570e1cc5198c941413750e021f42c214/Package.swift)
is the SwiftPM library product for embedding the same
tools. They expose tmux discovery, captures, waits, input, configuration,
and workspace application.

The package requires Swift 6.2 or newer and supports Linux and macOS.
The documented Darwin dependency build uses Xcode's Swift 6.3 toolchain.
tmux is required at runtime.

## Start here

- [Tools](./tools/) lists the MCP operations, arguments, and results.
- [Guides](./guides/) build the executable and configure its environment.
- [Topics](./topics/) explain tiers, exact tool selection, and opaque targets.
- [Examples](./examples/) call a tool, then explore server internals.
- [Language API](./api/) documents embedding and implementation types.

The default tier is readonly. Writing tools need explicit opt-in.
Resources expose snapshots, sessions, filter vocabulary, and pane content;
prompts package command, waiting, and workspace workflows.

The `apply_workspace` tool uses
[Workspace Manager](../workspace/). Its name does not imply convergence:
an existing session with the requested name is refused.

[Library contract](https://github.com/libtmux/libtmux-swift/blob/f02a4668570e1cc5198c941413750e021f42c214/Sources/LibTmuxMCP/README.md)
and [platform requirements](https://github.com/libtmux/libtmux-swift/blob/f02a4668570e1cc5198c941413750e021f42c214/README.md#requirements).
