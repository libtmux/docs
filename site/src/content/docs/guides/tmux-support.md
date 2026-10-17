---
supportedPorts: []
title: tmux support
description: The tmux release every libtmux port requires, how a library refuses an older daemon, and which optional features need a newer release.
sidebar:
  label: tmux support
  group: Guides
  order: 8
tableOfContents: true
---

Every libtmux port, the MCP servers and the workspace builders support tmux
3.3a and newer. A daemon older than 3.3a is refused before the requested
operation has any effect. A few optional features need a newer release; each
one is refused on its own and does not raise the minimum for anything else.

## The core minimum

The minimum for ordinary reads, writes, batches, raw commands, workspace
loading and MCP tools is tmux 3.3a. Releases compare in full, including patch
letters, so 3.3 is below the minimum and 3.3a is the first supported release.
A development build such as `next-3.9` ranks below the release it precedes, and
a release candidate ranks below its release. A version the library cannot
read is refused, not assumed to be new enough.

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

Running `tmux -V` or `tmux -h` on an older executable still works; see the
[command reference](/tmux/latest/manual/full/#COMMANDS). Their output does not
authorize later operations.

The check assumes tmux's built-in commands keep their meaning. A
[`command-alias`](/tmux/latest/manual/full/#OPTIONS) that redefines a built-in command the library uses to
identify or guard the daemon is outside this guarantee, as are the contents
of user-written aliases and shell programs a library only forwards.

## Optional features

Some operations depend on behavior that only newer releases have, or that a
particular release gets wrong. A library decides from the daemon's release
before it dispatches the operation, then either keeps working through another
path or refuses with an error that names the requirement.

| Feature | Requires | On an earlier release |
| ------- | -------- | --------------------- |
| Library-managed control mode: automatic transports, attach, reconnect, watches, mirrors, streams, subscriptions | tmux 3.7 | The library uses subprocess and polling paths. An operation with no such path is refused with a version error. A control client that attaches during initialization can crash the server on older releases. |
| Named buffer deletion and rename, and cleanup that relies on them | tmux 3.4 | The command can act on an unrelated buffer when the name is missing. Named `paste-buffer -d -b` stays available on 3.3a. |
| Captured standard output of `run-shell` | Not 3.3 or 3.4 | Those releases send the output to a view-mode pane. Background and pane-targeted jobs keep their native behavior. |
| `break-pane` | Not exact 3.7 | Exact 3.7 aborts on an unnamed call and ignores a name it is given. A call that supplies the window name is repaired by a following rename. 3.7a and later use native behavior. |
| Session and window names containing `:` or `.` | Not exact 3.7 | Exact 3.7 rejects them, so the library refuses before dispatch. Other releases accept them or rewrite them. |
| Percentage splits | Any, with `-l N%` | Typed requests always send `-l N%`. A raw `split-window -p` is refused on 3.4, which reads the value as a size. |
| Layout strings | tmux 3.4 for unchecked input | 3.3a can crash on an invalid layout string. Libraries accept only checksummed layouts or unique preset names before 3.4 and refuse the rest. |

Two details limit what these promises cover. Control mode also needs a tmux
client that is compatible with the daemon; a client older than the daemon can
fail to register even when the daemon qualifies. Guards apply to library-chosen
operations and to literal tmux command items, including items in a batch. They
do not look inside opaque shell text or the body of a configured alias.

Libraries also keep their own readiness, buffering and cleanup rules on
current releases. A command reply marks completion only where the command says
it does. Where a result depends on a pane's application, a library waits on a
marker or a state check, and a cursor position is a heuristic, not a promise.

## Support states

This page and the port notes use five states. They describe a feature in a
stated scope, never a whole port.

| State | Meaning |
| ----- | ------- |
| Non-operative | The requested behavior is absent, rejected or incorrect. |
| Timing-sensitive | A known interleaving or workload can fail. |
| Operative with synchronization | The contract needs explicit readiness, buffering or completion conditions. |
| Qualified | The named checks passed for the stated scope. |
| Unverified | Evidence is missing, incomplete or skipped. |

An unsupported-feature test can qualify a refusal. Skipping that test cannot.
An idle control attachment does not qualify concurrent acquisition, and a
feature that accepts a flag has not shown that it implements the flag.

On the releases listed in the feature table, the native behavior is
Non-operative for named buffer cleanup below 3.4, `run-shell` capture on 3.3
and 3.4, unnamed `break-pane` on exact 3.7, names containing `:` or `.` on
exact 3.7, raw `-p` on 3.4 and invalid layouts on 3.3a. Control acquisition
below 3.7 is Timing-sensitive: a short-lived attach can crash the server. Where
a library keeps working above a threshold, control mode is Operative with
synchronization because readiness and output framing need explicit waits.

## What each port does

The table lists what each port enforces and the state of that refusal. It
records only ports with checked evidence; every other port is Unverified.
Qualified here means native Linux runs against the stated releases. It does not
extend to macOS or to a hosted CI matrix.

| Port | Control mode | Named buffers | `run-shell` capture | `break-pane`, names, `-p`, layouts | State |
| ---- | ------------ | ------------- | ------------------- | ---------------------------------- | ----- |
| Python (`libtmux`) | Needs 3.7 before a control client starts | Needs 3.4 | Needs 3.5 for a foreground job | Gated as in the feature table | Qualified |
| tmuxp workspace | Inherits the Python gates; checks the Python engine's policy version before importing builders | Inherits | Inherits | Malformed literal layouts refused on 3.3a; exact 3.7 pane breaks need a window name | Qualified |
| Go | Needs 3.7; pins the socket before attaching | Needs 3.4; MCP `paste_text` stages only with 3.4 | Needs 3.5 for a foreground job | Gated as in the feature table | Qualified |
| Rust | Needs a stable 3.7 or newer; development and release-candidate daemons are refused before control starts | Needs 3.4, including managed paste staging | Needs 3.5 | Gated as in the feature table, checked across a whole literal command chain before the first command runs | Qualified |
| Java, Kotlin, Scala | Not recorded | Not recorded | Not recorded | Not recorded | Unverified |
| C#, F#, PowerShell | Not recorded | Not recorded | Not recorded | Not recorded | Unverified |
| C++, Swift, TypeScript, Ruby, Lua, Julia | Not recorded | Not recorded | Not recorded | Not recorded | Unverified |

MCP servers apply the same core check to each tool call. A tool that needs
control mode, such as `wait_for_text` in the Go server, reports the 3.7
requirement and does not raise the server's minimum.

A port's own compatibility page names the releases it was run on. Those runs
are historical records of the versions they describe; they are not a statement
about the minimum.
