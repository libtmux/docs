---
title: Ruby MCP guides
description: Connect an MCP client to a private tmux server and select its tools.
port: ruby
product: mcp
sidebar:
  label: Overview
  group: Guides
  order: 1
cards:
  - label: Connect a client
    href: connect-client/
    body: Build a pinned launcher, inspect its tools, and close its private daemon with the client.
---

Start with a private tmux server and the default read-only catalog. The client
guide includes the complete launcher, dependency setup, client configuration,
and connection checks.

## Select the tmux server

`--socket PATH` selects an explicit socket; `--socket-name NAME` selects a
named socket. `--endpoint` assigns the public alias used in discovery and
resource URIs. It does not choose the socket.

The [client launcher](connect-client/) creates and owns its tmux daemon.
When an application already owns the daemon, the MCP command borrows its
endpoint: end of input closes the protocol clients without stopping tmux.
The owning application remains responsible for the daemon's lifetime.

## Enable observation

Screen capture and waits are absent from the default catalog. In the client
guide's `run-mcp.rb`, add `"--enable-tool", "tmux_capture"` or
`"--enable-tool", "tmux_wait"` to the array passed to `LibTmux::MCP::CLI.run`.
The launcher does not forward arguments from the client configuration.

When launching the installed `libtmux-mcp` executable directly, pass
`--enable-tool tmux_capture` or `--enable-tool tmux_wait` as command arguments.

`tmux_wait` can observe screen text or a process exit. Strong process tracking
requires tmux 3.3 or newer and a supported native identity backend. A refusal
means the required evidence is unavailable; it is not a successful wait.
See the [tool reference](../tools/) for arguments and results.

## Enable mutations

Add another `--enable-tool` pair for `tmux_create`, `tmux_send`, or `tmux_close`
in the same launcher array or executable arguments.
Creation accepts command argument arrays. Sending text and sending named keys
are separate variants. A dispatch receipt does not claim that the pane program
completed.

The [source-owned MCP guide](../source-guide/) covers tool policy and shell
enrollment. The [snapshot topic](../topics/snapshots-and-references/) explains
the references used to address observed objects.
