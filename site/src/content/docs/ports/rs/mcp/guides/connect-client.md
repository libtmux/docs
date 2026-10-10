---
title: Connect an MCP client
description: Install the Rust MCP server, choose its tmux socket, and inspect the tools your client can call.
port: rs
product: mcp
sidebar:
  group: Guides
  order: 10
---

`tmux-mcp` connects an MCP client to one tmux server. The client launches
the executable and exchanges JSON-RPC messages over stdin and stdout.
The launcher writes diagnostics to stderr.

Use Rust 1.88 or newer, Git, and tmux 3.2a or newer on Linux or macOS.
The command below uses the tested Rust 1.97.1 toolchain and installs the
source revision used by this documentation's MCP reference. Cargo's
binary directory must be on the path available to your MCP client.

## Install and connect

```console
$ cargo +1.97.1 install \
    --git https://github.com/libtmux/libtmux-rs \
    --rev a6fc2a65674177b92b17fa380757155d2ba150fd \
    --locked \
    tmux-mcp
```

Check that the installed command runs:

```console
$ tmux-mcp --version
```

Expected output:

```text
tmux-mcp 0.1.0-alpha.16
```

For a client that accepts `mcpServers`, add this entry to its configuration:

```json
{
  "mcpServers": {
    "tmux-rust": {
      "command": "tmux-mcp",
      "env": {
        "LIBTMUX_TOOLSETS": "inspect"
      }
    }
  }
}
```

Restart the connection after changing its environment. The server chooses
its socket and tools once at startup. Running `tmux-mcp` in a terminal
waits for protocol input; it does not open an interactive tmux client.

This configuration offers inspection tools. They read metadata and terminal
output, and include bounded observation through
[`wait_for_text`](../../tools/wait_for_text/). They do not send pane input
or create sessions. See [Tool selection](../../topics/tool-selection/)
to add those operations deliberately.

## Check the connection

Ask your client to list the available tools, then read
`tmux://capabilities`. Its connection fields identify the resolved socket,
whether a daemon already existed, and what the launcher knows about its
configuration. Its effective tool list should match discovery.

Call [`list_sessions`](../../tools/list_sessions/) with this MCP
`tools/call` params object:

```json
{
  "name": "list_sessions",
  "arguments": {}
}
```

Use the returned IDs for subsequent calls. An empty list is normal on a
new daemon: connecting the MCP client does not create a session.

Without a socket selector, the launcher uses the dedicated
`libtmux-mcp` socket. If `LIBTMUX_TMUX_CONFIG` is also unset, it starts a
missing daemon with its shipped minimal configuration. An existing daemon
keeps its configuration. An explicit configuration disables this automatic
startup. The launcher does not choose the socket from `TMUX`.

## Connect to an existing server

To work with a named tmux server, use the same name in the client entry:

```json
{
  "mcpServers": {
    "tmux-rust": {
      "command": "tmux-mcp",
      "args": ["--socket-name", "work"],
      "env": {
        "LIBTMUX_TOOLSETS": "inspect"
      }
    }
  }
}
```

The `work` daemon must already exist for inspection calls to succeed.
Selecting an absent explicit socket does not start a daemon during
connection. Read the startup connection report and distinguish that case
from an existing daemon with no sessions.

Use `--socket` with an absolute socket path instead when the server was
started with `tmux -S`. Do not combine the two socket flags.
`LIBTMUX_SOCKET` and `LIBTMUX_SOCKET_PATH` supply the corresponding
environment settings; an explicit command-line selector takes precedence.

Socket selection limits which tmux objects the process can address.
Commands sent to panes still run with the tmux user's filesystem,
network, and process access. Tool selection describes the callable
interface, not an operating-system permission boundary.

## Stop the connection

Closing the client's protocol input ends the MCP process. It leaves an
explicitly selected daemon running. For the default dedicated daemon,
the process that created it stops it only when no other MCP process
still holds a connection lease.

If the creating process exits while another connection remains, it leaves
the daemon running. The remaining process did not create that daemon, so
its later exit does not stop it either. Inspect the selected socket before
stopping a daemon manually.

## Diagnose startup failures

Read the client's server log for stderr. An unknown tool name, malformed
selection, conflicting socket settings, or an empty or relative
`LIBTMUX_TMUX_CONFIG` value stops startup. Correct the setting before reconnecting.

If the executable cannot be found, configure the client with the installed
binary's absolute path. If a tool is missing, compare discovery with
`tmux://capabilities` and the [selection rules](../../topics/tool-selection/).
For a missing session or pane, list the objects again before choosing
another target.

[Launcher source](https://github.com/libtmux/libtmux-rs/blob/a6fc2a65674177b92b17fa380757155d2ba150fd/crates/tmux-mcp/src/bin/tmux-mcp.rs)
defines socket selection and shutdown.

