---
title: Connect a Java MCP client
description: Build the Java MCP launcher and connect it to a private tmux server.
port: java
product: mcp
sidebar:
  label: Guides
  order: 2
---

Build the Java distribution and let your MCP client launch the script below.
It creates its own tmux session, exposes only `list_sessions`, and stops that
private server when the MCP process exits.

## Build the launcher

Use JDK 25, Git, and tmux 3.2a or newer on a Unix host. Create an empty directory:

```console
$ mkdir java-mcp-client && cd java-mcp-client
```

Fetch the source revision used by this guide and build its distribution:

```console
$ git init libtmux-source && \
    git -C libtmux-source remote add origin https://github.com/libtmux/libtmux-java.git && \
    git -C libtmux-source fetch --depth=1 origin 842228310449e879ebcaa3f910597757c9dbffd6 && \
    git -C libtmux-source checkout --detach FETCH_HEAD && \
    ./libtmux-source/gradlew --no-daemon --max-workers=2 \
    -p libtmux-source :libtmux-mcp:installDist
```

The selected build downloads its Temurin 21 compiler when needed. The resulting
application contains the launcher and required JARs; keep its directory intact.

## Save the private-server launcher

Save the following file alongside the source checkout. It clears inherited
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
    "$project/libtmux-source/libtmux-mcp/build/install/libtmux-mcp/bin/libtmux-mcp" \
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
[launcher contract](https://github.com/libtmux/libtmux-java/blob/842228310449e879ebcaa3f910597757c9dbffd6/libtmux-mcp/README.md)
describes the direct command's flags and environment.
