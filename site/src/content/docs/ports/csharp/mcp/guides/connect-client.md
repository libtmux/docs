---
title: Connect an MCP client
description: Install the .NET tool, select its tmux endpoint, and verify discovery and ownership.
port: csharp
product: mcp
sidebar:
  group: Guides
  order: 10
---

Configure your MCP client to launch `libtmux-mcp`. The executable selects one
tmux socket and its tools at startup, then serves MCP over stdin and stdout.
Use Linux, macOS, or WSL with tmux 3.2a or newer and a compatible .NET runtime.

The examples here use the [published package](https://www.nuget.org/packages/LibTmux.Mcp/0.0.0-alpha.20)
and its [source contract](https://github.com/libtmux/libtmux-dotnet/blob/ec8b6ab2a4f65e23664f43fba538ba200d4ae8bc/src/LibTmux.Mcp/README.md).

## Install the tool

Install the pinned alpha release with the .NET SDK:

```console
$ dotnet tool install \
    --global \
    --version 0.0.0-alpha.20 \
    LibTmux.Mcp
```

The package targets .NET 8 and .NET 10. It installs the `libtmux-mcp`
executable; `dotnet add package` is not the installation method for this tool.
The client's launch environment must include the .NET tools directory on
`PATH`, normally [`$HOME/.dotnet/tools`](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-tool-install#global-tools)
on a POSIX host.

For a project-local installation and a complete C# client, use
[List sessions through MCP](../../examples/inspect-sessions/).

## Connect to an existing server

This client configuration selects the existing socket named `docs-agent`
and enables inspection tools:

```json
{
  "mcpServers": {
    "tmux": {
      "command": "libtmux-mcp",
      "env": {
        "LIBTMUX_SOCKET": "docs-agent",
        "LIBTMUX_TOOLSETS": "inspect"
      }
    }
  }
}
```

Use the name of the server you intend to inspect. A socket name corresponds
to tmux's `-L` option. `LIBTMUX_SOCKET_PATH` instead selects one absolute
socket path, corresponding to `-S`. Set only one of these variables.

The selection is not taken from an inherited `TMUX` value. `TMUX_PANE` can
identify the calling pane when the client runs inside the selected server;
discovery and mutation tools use that context to avoid inappropriate input
to the caller. Explicitly selecting a socket still requires checking that it
is the server you intend to control.

Ask the connected client to list tools, read `tmux://capabilities`, and call
[`list_sessions`](../../tools/list_sessions/). Check the reported socket and
session names before sending input. The capability resource records the
startup selection; use [`get_server_info`](../../tools/get_server_info/) and
the hierarchy tools for current state.

## Use the dedicated server

Omit both socket variables to select the dedicated `libtmux-mcp` socket.
When that endpoint is absent, the launcher can create it using its bundled
minimal tmux configuration. A newly created dedicated endpoint defaults to
all four toolsets. Select `inspect` explicitly when that is all the client
needs.

An existing or explicitly selected endpoint defaults to `inspect`, `manage`,
and `execute`; teardown requires an explicit selection. An explicit
`LIBTMUX_TMUX_CONFIG` must be an absolute, nonempty path. Using your own
configuration also affects the launcher's ownership classification and
default tool selection. Read the capability report instead of inferring
ownership from the socket's name.

On shutdown, the MCP process stops only a dedicated daemon whose launch
marker still matches that process. It leaves borrowed and replaced daemons
running. Closing an MCP client does not promise to stop work already running
in a borrowed pane.

## Diagnose startup

Read stderr in the client's server log. Keep stdout exclusively for protocol
messages; a shell startup message on stdout can break the connection.

- If `libtmux-mcp` is not found, check the client's `PATH` or configure the
  installed executable's absolute path.
- If the tool cannot locate .NET, set `DOTNET_ROOT` to the runtime installation
  used by that client. Desktop launchers may not inherit a version manager's
  shell setup.
- Use `LIBTMUX_TMUX` to select a particular tmux executable. It is resolved
  when the MCP server starts.
- Set either `LIBTMUX_SOCKET` or `LIBTMUX_SOCKET_PATH`, and use an absolute
  path for the latter. The executable takes no positional socket argument.
- Check toolset and tool names against [Tool selection](../../topics/tool-selection/).
  Unknown names and malformed comma-separated lists stop startup.
- Remove `LIBTMUX_SAFETY` if it is present. This release rejects the retired
  variable instead of treating it as an additional policy.

Restart the MCP connection after changing its environment. Changing a
terminal's environment does not reconfigure a server process already running
inside another client.

The [startup implementation](https://github.com/libtmux/libtmux-dotnet/blob/ec8b6ab2a4f65e23664f43fba538ba200d4ae8bc/src/LibTmux.Mcp/Policy/McpStartup.cs)
defines socket selection and ownership. The
[tool-selection implementation](https://github.com/libtmux/libtmux-dotnet/blob/ec8b6ab2a4f65e23664f43fba538ba200d4ae8bc/src/LibTmux.Mcp/Policy/CapabilitySelection.cs)
defines registration and filter precedence.
