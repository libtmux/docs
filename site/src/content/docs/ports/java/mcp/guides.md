---
title: Connect a Java MCP client
description: Build the Java MCP server from Maven Central and connect a client to a running tmux server.
port: java
product: mcp
equivalence: mcp-client-setup
sidebar:
  label: Guides
  order: 2
---

Build the `libtmux-mcp` distribution, then configure your MCP client to run
its start script against a tmux server that is already running. The server
connects to the tmux server you name and offers the tools you select. You start
and stop that tmux server yourself.

## Build the server

Use JDK 25, Gradle 9, and tmux 3.3a or newer on a Unix host. Create an empty
directory:

```console
$ mkdir java-mcp-client && cd java-mcp-client
```

Save the settings file:

```kotlin title="settings.gradle.kts"
rootProject.name = "libtmux-mcp-server"
```

Save the build file. Gradle resolves `libtmux-mcp` 0.1.2 and its dependencies
from Maven Central, and `installDist` writes a start script for the MCP
server's `io.github.libtmux.mcp.Main`
([source](https://github.com/libtmux/libtmux-java/blob/e8a39689d8d60968ac978a1dd2a89c6112333896/libtmux-mcp/src/main/java/io/github/libtmux/mcp/Main.java)):

```kotlin title="build.gradle.kts"
plugins {
    application
}

repositories { mavenCentral() }
dependencies {
    implementation("io.github.libtmux:libtmux-mcp:0.1.2")
    runtimeOnly("org.slf4j:slf4j-nop:2.0.17")
}
java { toolchain { languageVersion.set(JavaLanguageVersion.of(25)) } }
application {
    mainClass.set("io.github.libtmux.mcp.Main")
    applicationName = "libtmux-mcp"
}
```

Build the distribution:

```console
$ gradle --console=plain --no-daemon installDist
```

The resulting application contains the start script,
`build/install/libtmux-mcp/bin/libtmux-mcp`, and its required JARs; keep its
directory intact.

## Choose the tmux server

Select the server with `--socket` for a socket path or `--socket-name` for a
name under tmux's own socket directory. `--tmux` selects the tmux executable.
Environment alternatives are `LIBTMUX_SOCKET_PATH`, `LIBTMUX_SOCKET`, and
`LIBTMUX_TMUX_CONFIG`.

To try the server, start a tmux server on the socket name `mcp-example` with one
session:

```console
$ tmux -L mcp-example new-session -d -s mcp-example
```

Start the server with its input closed to see the toolsets and tools your
selection serves. It reports them on standard error, then exits:

```console
$ LIBTMUX_TOOLSETS= LIBTMUX_TOOLS=list_sessions \
    build/install/libtmux-mcp/bin/libtmux-mcp \
    --socket-name mcp-example < /dev/null
```

An MCP client keeps the input open, so the server waits for MCP messages on
stdin. Startup diagnostics go to stderr; stdout carries the MCP protocol.

## Connect a client

Configure the client to run the start script with the same arguments. For a
client that reads an `mcpServers` object, replace the command with the absolute
path of the script:

```json
{
  "mcpServers": {
    "tmux-java": {
      "command": "/absolute/path/to/libtmux-mcp",
      "args": ["--socket-name", "mcp-example"],
      "env": {
        "LIBTMUX_TOOLSETS": "",
        "LIBTMUX_TOOLS": "list_sessions"
      }
    }
  }
}
```

The client needs Java and tmux on its `PATH`, or a valid `JAVA_HOME` for Java.

## Verify and change selection

Read `tmux://capabilities`, list the offered tools, then call
[`list_sessions`](../tools/list_sessions/). This configuration offers only that
tool, and its result contains the `mcp-example` session.

An empty `LIBTMUX_TOOLSETS` plus the one name in `LIBTMUX_TOOLS` selects this
surface. Select `inspect,manage,execute` for a broader workflow. Reconnect
after changing startup configuration. Invalid tool names fail startup with a
visible diagnostic.

To connect to a server your application owns, pass its socket path with
`--socket`. Disconnecting the client leaves that tmux server running. Stop the
example server when you finish:

```console
$ tmux -L mcp-example kill-server
```

The [complete Java client example](../examples/) includes public imports,
project files, bounded requests, and owned-server cleanup. The
[`libtmux-mcp` README](https://github.com/libtmux/libtmux-java/blob/e8a39689d8d60968ac978a1dd2a89c6112333896/libtmux-mcp/README.md)
describes the start script's flags and environment.
