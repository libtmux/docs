---
title: Connect an MCP client
description: Install libtmux-mcp, choose its tmux server, and diagnose startup and shutdown.
port: go
product: mcp
sidebar:
  group: Guides
  order: 10
---

An MCP client starts `libtmux-mcp` and exchanges protocol messages over stdin
and stdout. The executable selects one tmux server at startup. Its diagnostics
go to stderr, which the client should retain in its server log.

## Install the command

Use Go 1.26 or newer and tmux 3.2a or newer on Linux, macOS, or WSL. Install the
[published MCP module](https://github.com/libtmux/libtmux-go/tree/6e7420927f4cb717fe089a710328e44e8d551025/mcp):

```console
$ go install \
    github.com/libtmux/libtmux-go/mcp/cmd/libtmux-mcp@v0.0.1-alpha.12
```

Make the Go installation directory available in the MCP client's `PATH`, or
set its command to the installed executable's absolute path. `GOBIN` selects
the installation directory; when unset, Go uses `bin` under its `GOPATH`.
Check the executable the client will launch:

```console
$ libtmux-mcp -version
```

The installed release reports `libtmux-mcp v0.0.1-alpha.12`. The
[complete SDK example](../../examples/inspect-sessions/) installs this same
release into a local `.tools` directory and supplies the client code.

## Choose a server

Without a socket selector, the launcher uses a dedicated socket named
`libtmux-mcp` and a minimal tmux configuration. This is separate from tmux's
ordinary default socket. A client using an `mcpServers` configuration can
launch an inspection-only instance with:

```json title="mcp.json"
{
  "mcpServers": {
    "tmux-go": {
      "command": "libtmux-mcp",
      "args": [],
      "env": {
        "LIBTMUX_TOOLSETS": "inspect"
      }
    }
  }
}
```

For an existing named server, set `args` to `["-socket-name", "docs-agent"]`.
Here, `docs-agent` must be the socket
name you chose when starting that server. For an absolute socket path, use
`-socket-path` instead. The executable also accepts `LIBTMUX_SOCKET` for a
name and `LIBTMUX_SOCKET_PATH` for an absolute path. Select one endpoint;
conflicting selectors fail startup.

Use `-binary` or `LIBTMUX_TMUX_BIN` to select the tmux executable. If you set
`LIBTMUX_TMUX_CONFIG`, supply a nonempty absolute configuration path. Reconnect
after changing the socket, executable, configuration, or tool selection.

## Inspect the selection

Report the tools selected by the same executable and environment:

```console
$ LIBTMUX_TOOLSETS=inspect libtmux-mcp -tools
```

This command probes the selected socket without starting a tmux server. The
result describes the tools a server started now would advertise; its defaults
depend on whether that socket already has a server. Read `tmux://capabilities`
through a connected client to inspect its frozen endpoint and tool selection.
The [tool-selection topic](../../topics/tool-selection/) explains how to add
individual tools and how exclusions affect batch operations.

## Diagnose startup

Run the doctor's check against the dedicated socket:

```console
$ libtmux-mcp -doctor -socket-name libtmux-mcp
```

The report describes the endpoint, tmux version, topology, and caller context.
Use the same socket and binary options as the client's configuration. A shell
and an MCP client may have different `PATH`, locale, and socket variables.

If the client cannot start the executable, check its command path first. If
the process starts and exits before connecting, inspect stderr for an old tmux
binary, conflicting socket settings, invalid configuration paths, unknown
tools, or malformed lists. An explicitly empty toolset selects no tools;
`none` is not a toolset name.

Keep stdout reserved for MCP messages. A process waiting silently on stdin
can be healthy. On client shutdown, a `terminated signal received` diagnostic
can reflect the client's ordinary termination of its subprocess.

## Shutdown and ownership

Closing the MCP transport ends its client connection. Do not use client
shutdown as proof that an application command stopped or an existing tmux
server was destroyed. The complete examples create and stop their own daemon,
with [separate cleanup deadlines](../../examples/inspect-sessions/#shutdown).

The [launcher source](https://github.com/libtmux/libtmux-go/blob/6e7420927f4cb717fe089a710328e44e8d551025/mcp/cmd/libtmux-mcp/main.go)
handles configuration and startup. The [instance lifecycle](https://github.com/libtmux/libtmux-go/blob/6e7420927f4cb717fe089a710328e44e8d551025/mcp/instance_lifecycle.go)
closes client sessions and their scoped work.
