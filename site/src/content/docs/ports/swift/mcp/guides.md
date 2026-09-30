---
title: Connect a Swift MCP client
description: Build the Swift MCP executable and connect it to a private tmux server.
port: swift
product: mcp
sidebar:
  label: Guides
  order: 2
---

Build the Swift executable, then let your MCP client launch the script below.
The script owns a private tmux server and exposes only `list_sessions`. It stops
tmux when the MCP process exits; it does not require an existing tmux session.

<a id="build-and-launch"></a>

## Build the executable

Use Swift 6.2.4, Git, and tmux 3.2a or newer on Linux. Create an empty directory
for the launcher and source checkout:

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

## Save the launcher

Save the following file alongside the source checkout. The trap preserves a
failed-stop socket for inspection and reports cleanup errors on stderr.

```sh title="run-mcp.sh"
#!/bin/sh
set -eu
unset TMUX TMUX_PANE LIBTMUX_SOCKET
project=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
directory=$(mktemp -d /tmp/libtmux-swift-mcp.XXXXXXXX)
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
LIBTMUX_SOCKET_PATH="$directory/s" \
LIBTMUX_TMUX_BIN=tmux LIBTMUX_TMUX_CONFIG=/dev/null \
LIBTMUX_TOOLSETS= LIBTMUX_TOOLS=list_sessions LIBTMUX_EXCLUDE_TOOLS= \
    "$project/libtmux-source/.build/debug/libtmux-mcp"
```

Run it directly to check startup:

```console
$ sh run-mcp.sh
```

It waits for MCP messages on stdin. Send EOF to close the process and trigger
cleanup. The executable accepts no flags; its endpoint and tool selection come
from environment variables.

## Connect a client

Configure the client to run `sh` with the launcher's absolute path as its only
argument. The client must have tmux on its `PATH`. The launcher finds the build
relative to its own file, so the client's working directory does not matter.

<a id="verify-and-narrow-the-surface"></a>

Ask the client to list its tools, then call
[`list_sessions`](../tools/list_sessions/). The offered surface contains only
that tool, and its result contains the launcher's `mcp-example` session.

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
