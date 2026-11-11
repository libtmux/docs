---
title: tmux workspace manager for Erlang, built from source
description: Plan JSON workspaces against a tmux server, review the saved plan and apply it with a standalone escript built from the Erlang source checkout.
port: erlang
product: workspace
sidebar:
  label: Overview
  order: 0
tableOfContents: true
---

The Erlang workspace manager plans and applies JSON workspaces through the
[core library](../core/). It is the `libtmux_erlang_workspace` application in
the same repository, with a standalone `libtmux-workspace` escript. No registry
package is published, so you build the escript from a source checkout:

```console
$ mise exec -- rebar3 escriptize
```

The build needs Erlang/OTP 29.1.2, Rebar3 3.28.0, Linux on x86_64 or arm64,
tmux 3.3a to 3.8, make and a C11 compiler. The escript runs on another machine
with the same architecture and OTP version, without a compiler or the checkout.

Planning observes the server and changes nothing. It writes a saved plan that
records stable targets, ownership markers and preconditions. Applying executes
that saved plan and stops when the server has drifted or a command outcome is
uncertain. A failure preserves the completed prefix.

A host configuration file names each endpoint and sets whether shell launches
are allowed. A workspace file cannot choose a socket. Plan a workspace against
your server with:

```console
$ mise exec -- _build/default/bin/libtmux-workspace plan \
    examples/workspace_apply.json \
    --config host.json \
    --output plan.json
```

The [workspace guide](../guides/workspace-json/) covers the JSON format, the
host configuration, the plan and apply commands, exit codes and recovery. It
also runs a complete example on its own server and checks that planning the
applied workspace again produces no steps. There is no separate API reference
for the workspace application yet.
