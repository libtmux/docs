---
title: TypeScript MCP API
description: Find the TypeScript server factory and the MCP tool, schema, and capability contracts.
port: ts
product: mcp
sidebar:
  label: Language API
  order: 4
---

For MCP client requests, use the [tool reference](../tools/). This page
covers language APIs for embedding or extending the server.

Import the server factory to embed MCP. Use protocol tool names when
communicating through an MCP client.

## Embedding API

`createTmuxMcpServer(tmux, options)` accepts a libtmux `Server` and
returns the SDK's [`McpServer`](https://ts.sdk.modelcontextprotocol.io/server).
Options can supply the caller environment,
tool-selection environment, resolved policy, and startup provenance.
Without supplied provenance, the factory treats the server as unprobed
with unknown configuration.

`serverFromEnvironment(environment)` builds the libtmux endpoint from
startup configuration. The executable combines endpoint resolution,
startup probing, policy selection, and stdio transport. An embedding
application owns its transport and shutdown.

[Exported server functions](https://github.com/libtmux/libtmux-ts/blob/f85b8de551353f746d50eaf36bf0112f4fe5a528/packages/mcp/src/server.ts)
and [in-process example](../examples/) describe this boundary.

## MCP reference

The [tool reference](../tools/) covers wire operations. Registered tools
publish input schemas, output schemas, structured results, and effect
annotations. The startup selection determines which tools are listed and
callable.

`tmux://capabilities` is a static JSON resource containing the frozen
surface and its declarations. There are no workflow prompts or dynamic
hierarchy-resource subscriptions.

[Resource registration](https://github.com/libtmux/libtmux-ts/blob/f85b8de551353f746d50eaf36bf0112f4fe5a528/packages/mcp/src/resources.ts).

Workspace parsing and application belong to
[`@libtmux/workspace`](../../workspace/internals/api/), not to a workspace MCP tool.
