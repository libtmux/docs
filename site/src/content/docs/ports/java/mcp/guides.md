---
title: Connect a Java MCP client
description: Build the Java application distribution and configure its endpoint and toolsets.
port: java
product: mcp
sidebar:
  label: Guides
  order: 2
---

Build the Java application distribution, then point the MCP client at its
launcher. Run these commands from the Java repository with JDK 21 or
newer and tmux installed.

## Build the launcher

```console
$ ./gradlew :libtmux-mcp:installDist
```

The distribution contains a `bin/libtmux-mcp` launcher and its required
JARs. Keep them together.

Launch it on a named socket with an inspection surface:

```console
$ LIBTMUX_TOOLSETS=inspect \
    libtmux-mcp/build/install/libtmux-mcp/bin/libtmux-mcp \
    --socket-name docs-agent
```

It serves MCP on standard input and output. Configure the client's command
to the launcher location. If the distribution's `bin` directory is on the
client's `PATH`, an `mcpServers` entry can use:

```json
{
  "mcpServers": {
    "tmux-java": {
      "command": "libtmux-mcp",
      "args": ["--socket-name", "docs-agent"],
      "env": {
        "LIBTMUX_TOOLSETS": "inspect"
      }
    }
  }
}
```

## Verify and change selection

Read `tmux://capabilities`, then call `list_sessions`.
Select `inspect,manage,execute` for workflows that create topology and
run pane commands. Reconnect after changing startup configuration.

`--socket` accepts a socket path; `--tmux` selects the tmux executable.
The environment also supports `LIBTMUX_SOCKET`,
`LIBTMUX_SOCKET_PATH`, and `LIBTMUX_TMUX_CONFIG`.

The retired `--safety`, `LIBTMUX_SAFETY`, `--watch`, and
`LIBTMUX_WATCH` settings fail startup. Use toolsets and bounded
observation tools instead.

[Launcher and flags](https://github.com/libtmux/libtmux-java/blob/4f057d367a25dee818d70876fa283fc503a3a7eb/libtmux-mcp/README.md).
