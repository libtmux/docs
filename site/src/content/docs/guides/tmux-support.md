---
supportedPorts: []
title: tmux support
description: The tmux release every libtmux port requires and how a library refuses an older daemon.
sidebar:
  label: tmux support
  group: Guides
  order: 8
tableOfContents: true
---

No libtmux port requires a tmux newer than 3.3a. The ports, the MCP servers
and the workspace builders support tmux 3.3a and newer, except Python and
Elixir, which state an earlier floor. A port that enforces its minimum
refuses an older daemon before the requested operation has any effect.

## Minimum by port

- Python (`libtmux`) and `libtmux-mcp`: tmux 3.2a.
- tmuxp: tmux 3.2a, the floor of the `libtmux` release it depends on. Its own
  README and quickstart say 3.2.
- Elixir: tmux 3.3.
- Every other port, with its MCP server and workspace builder: tmux 3.3a.

## The core minimum

The minimum for ordinary reads, writes, batches, raw commands, workspace
loading and MCP tools is the port's own, tmux 3.3a for most ports. Releases
compare in full, including patch letters, so 3.3 is below a 3.3a minimum and
3.3a is the first supported release. A development build such as `next-3.9`
ranks below the release it precedes, and a release candidate ranks below its
release. A version the library cannot read is refused, not assumed to be new
enough.

Libraries judge the daemon that answers on the selected socket, not the `tmux`
executable that sends the command. The two can differ, for example when a
newer client binary talks to a server started by an older one. The rules are:

- An existing server is checked by the version it reports. A newer client
  binary does not authorize an older daemon.
- With no server on the socket, the library validates the executable that
  would start one.
- A server that restarts on the same socket is checked again before ordinary
  operations use it.
- Typed methods, raw commands, command batches, workspace loading and MCP
  tools all pass the same check. A lenient listing call reports the refusal
  instead of returning an empty list.
- The refusal raises the port's version error and happens before the command
  runs, so a refused call leaves no session, window, option or buffer behind.

The Python library does not refuse an older tmux by itself. Its
`has_minimum_version` helper compares the version that the `tmux` executable
reports with 3.2a, and no library operation calls it. The Elixir port declares
its floor and tests it, and has no runtime refusal.

Running `tmux -V` or `tmux -h` on an older executable still works; see the
[command reference](/tmux/latest/manual/full/#COMMANDS). Their output does not
authorize later operations.

The check assumes tmux's built-in commands keep their meaning. A
[`command-alias`](/tmux/latest/manual/full/#OPTIONS) that redefines a built-in command the library uses to
identify or guard the daemon is outside this guarantee, as are the contents
of user-written aliases and shell programs a library only forwards.

## Release candidates

Release candidates are not supported. While a tmux release exists only as
candidates, a port can gate a feature on one of them, written `X.Y-rcN`, so
the feature works before the release ships. When the release ships, every
gate, test, CI job and page that names one of its candidates moves to the
release or is removed, and the candidates are no longer mentioned.

A candidate's version still parses and ranks below its release, as
[the core minimum](#the-core-minimum) describes. Beyond that ordering, no
port promises how it behaves against a candidate server.
