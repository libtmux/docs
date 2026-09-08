---
title: Java MCP examples
description: Embed the Java MCP server over an application-owned tmux server and transport.
port: java
product: mcp
sidebar:
  label: Examples
  order: 3
---

The public Java entry point accepts an existing libtmux `Server`.
An application can supply a custom MCP transport or use the stdio
entry point that the launcher uses.

## Supply a transport

This method exposes the
[public serving contract](https://github.com/libtmux/libtmux-java/blob/4f057d367a25dee818d70876fa283fc503a3a7eb/libtmux-mcp/src/main/java/io/github/libtmux/mcp/TmuxMcpServer.java):

```java
import io.github.libtmux.Server;
import io.github.libtmux.mcp.TmuxMcpServer;
import io.modelcontextprotocol.server.McpSyncServer;
import io.modelcontextprotocol.spec.McpServerTransportProvider;

public final class EmbeddedTmux {
    private EmbeddedTmux() {}

    public static McpSyncServer serve(
            Server server, McpServerTransportProvider transport) {
        return TmuxMcpServer.serving(server, transport);
    }
}
```

Ownership of the transport transfers on entry. The returned MCP server
closes it, including on failed startup. Close the returned server when
your application's serving lifetime ends.

The method reads selection from the process environment. Set that
environment before creating the server. For a subprocess that manages its
own lifecycle, use the [launcher guide](../guides/).

## Inspect command completion

On a disposable session, use an MCP client to discover a pane and invoke
`run_shell_command`. Read its typed exit status and output. Use
`capture_since` for later screen changes; the prompt redraw can arrive
after the command's completion signal.

The port's
[MCP tests](https://github.com/libtmux/libtmux-java/tree/4f057d367a25dee818d70876fa283fc503a3a7eb/libtmux-mcp/src/test)
exercise transport and real tmux behavior. The
[documentation tests](https://github.com/libtmux/libtmux-java/tree/4f057d367a25dee818d70876fa283fc503a3a7eb/docs-tests)
cover the port's collected snippets; this page's embedding wrapper is a
source-derived adaptation, not one of those collected snippets.
