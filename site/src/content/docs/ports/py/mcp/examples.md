---
title: Python MCP examples
description: List sessions through the Python MCP server and inspect implementation examples.
port: py
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

Use a FastMCP client to inspect the same registered server that the
`libtmux-mcp` executable serves. This checks the advertised contract
without creating tmux sessions.

### Inspect the catalog in Python

Run this in an environment containing `libtmux-mcp`. It uses the
production factory and closes the in-process client when the context ends.

```python
import asyncio

from fastmcp import Client
from libtmux_mcp.server import build_mcp_server


async def main() -> None:
    async with Client(build_mcp_server()) as client:
        tools = await client.list_tools()
        for tool in tools:
            print(tool.name, tool.input_schema)


asyncio.run(main())
```

The [production factory](https://github.com/tmux-python/libtmux-mcp/blob/v0.1.0a22/src/libtmux_mcp/server.py)
registers tools and applies visibility once. The
[server tests](https://github.com/tmux-python/libtmux-mcp/blob/v0.1.0a22/tests/test_server.py)
exercise this client/factory pattern. Set selection variables before
importing the server in a fresh process.

### Run and observe through a client

On a disposable session, ask the client to create a pane, run
`printf 'ready\n'` with `run_command`, and report its typed exit
status. For subsequent output, seed `capture_since` and reuse the returned
cursor. Use `wait_for_text` when waiting for output from a process you did
not launch.

These are workflows for the client to carry out, not literal tool argument
objects. Use the [tool reference](../tools/) for each operation's schema.

The [upstream quickstart](https://libtmux-mcp.git-pull.com/quickstart/)
describes command completion and lower-level channel composition.
