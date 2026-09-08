---
title: Java MCP API
description: Find the public TmuxMcpServer entry points and the separate schema-validated tool catalog.
port: java
product: mcp
sidebar:
  label: API
  order: 4
---

`TmuxMcpServer` is the public Java entry point. The MCP catalog includes
operations implemented by package-private classes; Java visibility does
not determine whether a tool exists on the wire.

## Java entry points

`TmuxMcpServer.overStdio(server)` serves through standard input and
output. `TmuxMcpServer.serving(server, transport)` accepts a custom
[`McpServerTransportProvider`](https://github.com/modelcontextprotocol/java-sdk/blob/v2.0.1/mcp-core/src/main/java/io/modelcontextprotocol/spec/McpServerTransportProvider.java).
Both return an SDK
[`McpSyncServer`](https://github.com/modelcontextprotocol/java-sdk/blob/v2.0.1/mcp-core/src/main/java/io/modelcontextprotocol/server/McpSyncServer.java).

The returned server owns its transport. Ownership transfers on entry,
including startup failure. The embedding application owns the broader
tmux server lifetime and closes the MCP server when serving ends.

[Public source contract](https://github.com/libtmux/libtmux-java/blob/4f057d367a25dee818d70876fa283fc503a3a7eb/libtmux-mcp/src/main/java/io/github/libtmux/mcp/TmuxMcpServer.java).

## MCP tools and resource

The [tool reference](../tools/) covers registered operation names and
input/output schemas. Results contain typed `structuredContent` and
JSON text. Expected tmux failures become tool errors so the caller can
inspect the failure and choose a recovery.

The `tmux://capabilities` resource is static for the process lifetime.
It reports tool selection, connection provenance, and capability
declarations. The server does not register prompts or dynamic hierarchy
subscriptions.

Use the [Workspace Manager API](../../workspace/api/) for declarative
configuration. It is a separate Java library and has no corresponding
workspace-file MCP route.
