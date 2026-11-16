---
title: Connect a Swift MCP client
description: Build the Swift MCP executable and configure a client to start it with its own tmux server.
port: swift
product: mcp
equivalence: mcp-client-setup
sidebar:
  label: Guides
  order: 2
---

Build the Swift executable, then configure your MCP client to start it. The
executable serves only the tools you select and does not require an existing
tmux session.

<a id="build-and-launch"></a>

## Build the executable

Use Swift 6.2.4, Git, and tmux 3.3a or newer on Linux. Create an empty directory
for the source checkout:

```console
$ mkdir swift-mcp-client && cd swift-mcp-client
```

Fetch the library revision and build its stdio server:

```console
$ git init libtmux-source && \
  git -C libtmux-source remote add origin https://github.com/libtmux/libtmux-swift.git && \
  git -C libtmux-source fetch --depth=1 origin 254f8b2be7eb60cacc3ffcb3ea8e456784f582df && \
  git -C libtmux-source checkout --detach FETCH_HEAD && \
  swift build --package-path libtmux-source --product libtmux-mcp --jobs 2
```

Keep the build directory: the executable uses its adjacent resource bundle.

## Connect a client

The executable accepts no flags; its endpoint and tool selection come from
environment variables. Print the absolute path of the built executable:

```console
$ realpath libtmux-source/.build/debug/libtmux-mcp
```

Configure the client to run that path with the environment below, which selects
the `list_sessions` tool alone. The client must have tmux on its `PATH`.

```json
{
  "mcpServers": {
    "tmux": {
      "command": "<absolute path printed above>",
      "env": {
        "LIBTMUX_TOOLSETS": "",
        "LIBTMUX_TOOLS": "list_sessions"
      }
    }
  }
}
```

Without `LIBTMUX_SOCKET` or `LIBTMUX_SOCKET_PATH`, the executable serves the
dedicated `libtmux-mcp` socket with its bundled minimal tmux configuration. It
needs no existing tmux session, and when stdio ends it removes only a dedicated
server that it started.

Run it directly to check startup:

```console
$ LIBTMUX_TOOLSETS= LIBTMUX_TOOLS=list_sessions \
    libtmux-source/.build/debug/libtmux-mcp
```

It reports the socket name and tool selection on stderr, then waits for MCP
messages on stdin. Send EOF to close the process.

<a id="verify-and-narrow-the-surface"></a>

Ask the client to list its tools, then call
[`list_sessions`](../tools/list_sessions/). The offered surface contains only
that tool. The dedicated server starts with no sessions, so the result is an
empty `sessions` list.

An empty `LIBTMUX_TOOLSETS` plus the named `LIBTMUX_TOOLS` selection excludes
other operations. Reconnect after changing the selection. Invalid selections
fail startup and write diagnostics to stderr.

For a server the application already owns, select its absolute socket with
`LIBTMUX_SOCKET_PATH` or its socket name with `LIBTMUX_SOCKET`; these settings
are mutually exclusive. `LIBTMUX_TMUX_BIN` selects a specific tmux executable.

The [complete embedded example](../examples/) calls the Swift tool surface
inside a consumer program. The
[executable contract](https://github.com/libtmux/libtmux-swift/blob/254f8b2be7eb60cacc3ffcb3ea8e456784f582df/Sources/libtmux-mcp/README.md)
describes its environment and protocol behavior.
