---
title: "Inspect a workspace through MCP"
description: "Connect the development C++ MCP server to a session loaded by its native workspace CLI."
port: cxx
product: workspace
sidebar:
  label: "Inspect through MCP"
  group: "Guides"
  order: 28
tableOfContents: true
---

Inspect the session you loaded with the C++ workspace CLI by pointing its MCP
server at the same tmux socket. The loaded windows and panes are ordinary tmux
objects; discovery returns their existing IDs.

**This guide uses development `workspace-cli` source.** Continue the
[installation walkthrough](../installation/#load-and-inspect) through its
detached load, keeping that shell and `WORKSPACE_TMP` available. Leave the
`workspace-guide` session running. Build both executables from the same native
repository checkout; released package instructions may describe different MCP
contracts.

## Build the MCP server

Run from the native repository root with the installation walkthrough's
toolchain and dependencies.

```console
$ cmake --preset cxx-dev \
    -DLIBTMUX_BUILD_WORKSPACE_CLI=ON \
    -DLIBTMUX_BUILD_MCP_SERVER=ON
```

Build the MCP executable; the target also copies its minimal configuration:

```console
$ cmake --build --preset cxx-dev \
    --target libtmux_mcp_server \
    --parallel 2
```

## Select the same socket

Configure an MCP client to launch the following command with the shown
environment. The client owns the process's standard input and output for
JSON-RPC messages.

```console
$ LIBTMUX_TOOLSETS=inspect \
    build/cxx-dev/apps/mcp/libtmux-mcp-server \
    --socket-path "$WORKSPACE_TMP/tmux.sock"
```

In a client's configuration file, use absolute executable or script paths and
expand `WORKSPACE_TMP` to its actual value. Configuration files do not perform
shell variable expansion. Retain the environment used to build and run the
native executable.

For a workspace loaded with `-L NAME`, use MCP's `--socket-name NAME` instead.
Keep the same tmux executable on `PATH` for both processes.

## Inspect and wait

1. Discover tools with `tools/list` and read the `tmux://capabilities` resource.
   Confirm that its resolved endpoint matches the loaded socket.
2. Call [list_sessions][mcp-source], then [list_windows][mcp-source] with
   `session: "workspace-guide"`, and [list_panes][mcp-source]. Retain the
   returned session, window and pane IDs.
3. Select one returned pane ID for capture or a bounded text wait. Use the
   argument names below; discover the full schema before adding options.

| Tool | Arguments |
| --- | --- |
| [capture_pane][mcp-source] | `"paneId"` |
| [wait_for_text][mcp-source] | `"target"`, literal `"text"`, `"timeout_ms"` in milliseconds |

Set `"timeout_ms"` to `10000` for a ten-second wait. A pending wait permits
other inspection calls on the same connection. To check that behavior, start a
wait for text absent from the pane, then request [list_panes][mcp-source] before
its deadline. Client cancellation uses `notifications/cancelled` with the
outstanding request ID; the connection remains usable for inspection.

[capture_pane][mcp-source] returns visible text. Use [snapshot_pane][mcp-source]
for structured screen state and [capture_since][mcp-source] for incremental
observation.

If discovery does not show `workspace-guide`, compare the resolved socket in
capabilities with the CLI's `-S` path. A different socket selects a different
daemon even when session names match.

## Close the connection

Close the MCP connection's standard input to stop the server and release pending
work. This separately loaded workspace remains running. When you finish the
walkthrough, remove only its session on the same socket:

```console
$ tmux \
    -S "$WORKSPACE_TMP/tmux.sock" \
    kill-session \
    -t '=workspace-guide'
```

The configuration remains in the temporary directory until you remove it.

See the verified [native workspace workflow][workspace-source] and [development
MCP reference][mcp-source] for this source contract. The site's released MCP
pages retain their version-pinned contracts.

[workspace-source]: https://github.com/libtmux/libtmux-cxx/blob/ef40c60dceafa890fc32b85ff7ee0c24baf84440/apps/workspace/README.md
[mcp-source]: https://github.com/libtmux/libtmux-cxx/blob/ef40c60dceafa890fc32b85ff7ee0c24baf84440/apps/mcp/README.md
