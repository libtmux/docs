---
title: Connect a Java MCP client
description: Build the Java MCP launcher from Maven Central and connect it to a private tmux server.
port: java
product: mcp
equivalence: mcp-client-setup
sidebar:
  label: Guides
  order: 2
---

Build the Java launcher and let your MCP client launch the script below.
It creates its own tmux session, exposes only `list_sessions`, and stops that
private server when the MCP process exits.

## Build the launcher

Use JDK 25, Gradle 9, and tmux 3.3a or newer on a Unix host. Create an empty
directory:

```console
$ mkdir java-mcp-client && cd java-mcp-client
```

Save the settings file:

```kotlin title="settings.gradle.kts"
rootProject.name = "libtmux-mcp-launcher"
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

Build the launcher:

```console
$ gradle --console=plain --no-daemon installDist
```

The resulting application contains the start script and required JARs; keep
its directory intact.

## Save the private-server launcher

Save the following file beside `build.gradle.kts`. It clears inherited
endpoint, caller and tool-selection settings before choosing its own. The trap
reports cleanup failures and retains a socket that could not be stopped.

```sh title="run-mcp.sh"
#!/bin/sh
set -eu
unset TMUX TMUX_PANE LIBTMUX_SOCKET LIBTMUX_SOCKET_PATH
unset LIBTMUX_SAFETY LIBTMUX_WATCH LIBTMUX_EXCLUDE_TOOLS
project=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
directory=$(mktemp -d /tmp/libtmux-java-mcp.XXXXXXXX)
cleanup() {
    status=$?
    trap - 0 HUP INT TERM
    if [ -S "$directory/s" ]; then
        if ! tmux -S "$directory/s" kill-server; then
            printf 'Cannot stop private server; inspect %s\n' "$directory" >&2
            exit 1
        fi
    fi
    if ! rm -f "$directory/s" || ! rmdir "$directory"; then
        printf 'Cannot remove private directory: %s\n' "$directory" >&2
        exit 1
    fi
    exit "$status"
}
trap cleanup 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
tmux -S "$directory/s" -f /dev/null \
    set-option -g default-shell /bin/sh \; \
    set-environment -g ENV '' \; \
    set-environment -g BASH_ENV '' \; \
    new-session -d -s mcp-example 'exec /bin/cat'
LIBTMUX_TMUX_CONFIG=/dev/null LIBTMUX_TOOLSETS= LIBTMUX_TOOLS=list_sessions \
    "$project/build/install/libtmux-mcp/bin/libtmux-mcp" \
    --socket "$directory/s" --tmux tmux
```

Run it directly to check startup:

```console
$ sh run-mcp.sh
```

It waits for MCP messages on stdin. Send EOF to close the process and trigger
cleanup. Startup diagnostics go to stderr; stdout carries the MCP protocol.

## Connect a client

Configure the client's command as `sh` and pass the launcher's absolute path
as its only argument. The client needs Java and tmux on its `PATH`, or a valid
`JAVA_HOME` for Java. The launcher finds the distribution relative to its own
file, so the client's working directory does not matter.

## Verify and change selection

Read `tmux://capabilities`, list the offered tools, then call
[`list_sessions`](../tools/list_sessions/). This launcher offers only that tool,
and its result contains the private `mcp-example` session.

An empty `LIBTMUX_TOOLSETS` plus the one name in `LIBTMUX_TOOLS` selects this
surface. Select `inspect,manage,execute` for a broader workflow. Reconnect
after changing startup configuration. Invalid tool names fail startup with a
visible diagnostic.

To connect the distribution directly to a server your application already
owns, pass `--socket` with its path or `--socket-name` with its name.
`--tmux` selects the tmux executable. Environment alternatives are
`LIBTMUX_SOCKET_PATH`, `LIBTMUX_SOCKET`, and `LIBTMUX_TMUX_CONFIG`.

The [complete Java client example](../examples/) includes public imports,
project files, bounded requests, and owned-server cleanup. The
[launcher contract](https://github.com/libtmux/libtmux-java/blob/e8a39689d8d60968ac978a1dd2a89c6112333896/libtmux-mcp/README.md)
describes the direct command's flags and environment.
