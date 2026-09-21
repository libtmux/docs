---
title: Ruby MCP guides
description: Select a tmux socket, launch libtmux-mcp, and enable only the required tools.
port: ruby
product: mcp
sidebar:
  label: Guides
  order: 2
---

## Select the tmux server

Start tmux on an application-owned named socket, then configure the MCP server
with the same name. `--socket-name` selects tmux; `--endpoint` only assigns the
public alias used in discovery and resource URIs.

```console
$ tmux -L libtmux-docs new-session -d -s agent
```

```console
$ libtmux-mcp \
    --socket-name libtmux-docs \
    --endpoint local
```

Use `--socket PATH` instead when the application owns an explicit socket path.
The process serves MCP on standard input and output. End of input closes
retained protocol clients without stopping the borrowed tmux daemon.

## Enable observation

Screen capture and waits are absent from the default catalog. Add each one
explicitly:

```console
$ libtmux-mcp \
    --socket-name libtmux-docs \
    --enable-tool tmux_capture \
    --enable-tool tmux_wait
```

`tmux_wait` can observe screen text or a process exit. Strong process tracking
requires tmux 3.3 or newer and a supported native identity backend. A refusal
means the required evidence is unavailable; it is not a successful wait.

## Enable mutations

Repeat `--enable-tool` for `tmux_create`, `tmux_send`, or `tmux_close`.
Creation accepts command argument arrays. Sending text and sending named keys
are separate variants. A dispatch receipt does not claim that the pane program
completed.

[Source-owned MCP guide](../source-guide/)
