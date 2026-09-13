---
title: Python MCP API
description: Find Python server entry points, typed models, and the separate MCP wire contract.
port: py
product: mcp
sidebar:
  label: Language API
  order: 4
---

For MCP client requests, use the [tool reference](../tools/). This page
covers language APIs for embedding or extending the server.

The Python API and MCP protocol expose different interfaces. Python callers
import functions and models; MCP clients send registered tool names and
schema-validated arguments.

## MCP operations

Browse the [tool reference](../tools/) for the protocol catalog.
`tools/list` on a running server is the effective selection after
startup filtering. Registration defaults can differ from direct Python
function defaults, including command-history suppression.

The server also registers hierarchy resources and workflow prompts.
These remain available independently of the toolset selection.

## Python entry points

`libtmux_mcp.server.build_mcp_server()` returns the registered production
FastMCP server. `run_server()` serves it over stdio. The factory uses the
module's server instance; repeated calls do not create independent
configuration contexts.

The package separates tool functions, typed models, middleware, resource
handlers, and prompt recipes. Model classes describe request/result data;
their existence does not make them separate MCP tools.

- [Server API](https://libtmux-mcp.git-pull.com/reference/api/server/)
- [Tools API](https://libtmux-mcp.git-pull.com/reference/api/tools/)
- [Models API](https://libtmux-mcp.git-pull.com/reference/api/models/)
- [Registration source](https://github.com/tmux-python/libtmux-mcp/blob/v0.1.0a22/src/libtmux_mcp/server.py)

Use [Examples](../examples/) to inspect the protocol with an in-process
client. Use the [Workspace builder API](../../workspace/internals/api/) for tmuxp
configuration and builders.
