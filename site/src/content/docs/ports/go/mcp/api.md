---
title: Go MCP API
description: Find the Go managed server lifecycle and distinguish exported APIs from wire operations.
port: go
product: mcp
sidebar:
  label: Language API
  order: 4
---

For MCP client requests, use the [tool reference](../tools/). This page
covers language APIs for embedding or extending the server.

The Go MCP module exports a managed server instance. Tool handlers can be
private Go functions while their registered names remain public MCP
operations.

## Embedding lifecycle

`mcp.NewServer(target)` accepts a core tmux `Server` and returns an
`Instance` plus an error. Close the instance after serving to release
its runtime resources.

`Instance.Connect` connects a client transport. Custom transports use
`AssumeResponseCommit` only when a successful write commits exactly one
response. This is a transport contract, not a retry wrapper.

Applications that need the ordinary stdio lifecycle can use
`mcp.Run(ctx, target)`. The
[package reference](https://pkg.go.dev/github.com/libtmux/libtmux-go/mcp)
describes lifecycle, capacity, and transport ownership.

## MCP operations

The [tool reference](../tools/) covers registered names and schemas.
The optional recipe tool depends on startup configuration. Capabilities
and the operation ceiling filter both listing and invocation.

Resources expose metadata and content with their corresponding capability
gates. Prompts provide workflow recipes. `build_workspace` uses the
separate [workspace module](../../workspace/internals/api/).

[Server registration](https://github.com/libtmux/libtmux-go/blob/5f808882015a975a65acc7f9da5b3ff0d5cbdc91/mcp/server.go)
and [agent example](../examples/) connect the language and protocol APIs.
