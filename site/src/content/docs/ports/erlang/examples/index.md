---
port: erlang
route: examples
title: Examples
description: Run the eighteen tested Erlang programs against private tmux servers and read each one's guide.
---

Each program below is a module in the repository's `examples/` directory. The
core checks run them against private tmux servers and again as installed
consumers, and the guide named beside each one shows the whole program with its
setup command and expected result. Follow that guide's cleanup contract when
adapting a program to an existing server.

## Connect and inspect

| Program | What it demonstrates | Guide |
| --- | --- | --- |
| [inspect_demo.erl](https://github.com/libtmux/libtmux-erlang/blob/33fd7fe985454e375d5ac8533043cabf4a0b2fa5/examples/inspect_demo.erl) | Inspect an existing tmux socket without changing its sessions. | [Installation](../guides/installation/) |
| [readme_demo.erl](https://github.com/libtmux/libtmux-erlang/blob/33fd7fe985454e375d5ac8533043cabf4a0b2fa5/examples/readme_demo.erl) | Create a workspace, query its graph and preserve captured values. | [Getting started](../guides/getting-started/) |
| [linked_graph.erl](https://github.com/libtmux/libtmux-erlang/blob/33fd7fe985454e375d5ac8533043cabf4a0b2fa5/examples/linked_graph.erl) | Distinguish physical windows from their session memberships. | [Object graph](../concepts/object-graph/) |
| [filter_demo.erl](https://github.com/libtmux/libtmux-erlang/blob/33fd7fe985454e375d5ac8533043cabf4a0b2fa5/examples/filter_demo.erl) | Validate portable JSON and filter captured rows without tmux I/O. | [Selections and queries](../concepts/queries/) |
| [plan_demo.erl](https://github.com/libtmux/libtmux-erlang/blob/33fd7fe985454e375d5ac8533043cabf4a0b2fa5/examples/plan_demo.erl) | Explain a query, let tmux exclude candidates, then fetch it. | [Selections and queries](../concepts/queries/) |
| [control_demo.erl](https://github.com/libtmux/libtmux-erlang/blob/33fd7fe985454e375d5ac8533043cabf4a0b2fa5/examples/control_demo.erl) | Attach explicitly, inspect captured values and prove detachment. | [Control connections](../topics/control/) |
| [native_consumer.erl](https://github.com/libtmux/libtmux-erlang/blob/33fd7fe985454e375d5ac8533043cabf4a0b2fa5/examples/native_consumer.erl) | Construct native values and exercise a borrowed endpoint through public APIs. | Installed-consumer check |

## Run, send and capture

| Program | What it demonstrates | Guide |
| --- | --- | --- |
| [job_demo.erl](https://github.com/libtmux/libtmux-erlang/blob/33fd7fe985454e375d5ac8533043cabf4a0b2fa5/examples/job_demo.erl) | Capture a job that acknowledges terminal parsing before it exits. | [Owned operations](../guides/operations/) |
| [pipe_demo.erl](https://github.com/libtmux/libtmux-erlang/blob/33fd7fe985454e375d5ac8533043cabf4a0b2fa5/examples/pipe_demo.erl) | Save terminal bytes after a consumer acknowledgement. | [Pipe pane output](../guides/piping/) |
| [pane_demo.erl](https://github.com/libtmux/libtmux-erlang/blob/33fd7fe985454e375d5ac8533043cabf4a0b2fa5/examples/pane_demo.erl) | Isolate a running pane, then join it back without respawning. | [Panes](../guides/panes/) |
| [command_demo.erl](https://github.com/libtmux/libtmux-erlang/blob/33fd7fe985454e375d5ac8533043cabf4a0b2fa5/examples/command_demo.erl) | Build captured-target commands, then execute and inspect them. | [Commands](../guides/commands/) |
| [typing_demo.erl](https://github.com/libtmux/libtmux-erlang/blob/33fd7fe985454e375d5ac8533043cabf4a0b2fa5/examples/typing_demo.erl) | Type a command into a shell pane, wait for it, then read the screen. | [Getting started](../guides/getting-started/) |
| [batch_demo.erl](https://github.com/libtmux/libtmux-erlang/blob/33fd7fe985454e375d5ac8533043cabf4a0b2fa5/examples/batch_demo.erl) | Run several commands in one tmux client and read an option batch. | [Getting started](../guides/getting-started/) |

## Options, hooks, keys and buffers

| Program | What it demonstrates | Guide |
| --- | --- | --- |
| [options_demo.erl](https://github.com/libtmux/libtmux-erlang/blob/33fd7fe985454e375d5ac8533043cabf4a0b2fa5/examples/options_demo.erl) | Use local options to mark workspace ownership without inheritance. | [Options](../guides/options/) |
| [config_demo.erl](https://github.com/libtmux/libtmux-erlang/blob/33fd7fe985454e375d5ac8533043cabf4a0b2fa5/examples/config_demo.erl) | Apply session configuration and wait for its explicit signal. | [Configuration](../guides/configuration/) |
| [hook_demo.erl](https://github.com/libtmux/libtmux-erlang/blob/33fd7fe985454e375d5ac8533043cabf4a0b2fa5/examples/hook_demo.erl) | Acknowledge a registered split hook before reading its effect. | [Hooks](../guides/hooks/) |
| [key_demo.erl](https://github.com/libtmux/libtmux-erlang/blob/33fd7fe985454e375d5ac8533043cabf4a0b2fa5/examples/key_demo.erl) | Install and remove an application-owned key table. | [Keys](../guides/keys/) |
| [buffer_demo.erl](https://github.com/libtmux/libtmux-erlang/blob/33fd7fe985454e375d5ac8533043cabf4a0b2fa5/examples/buffer_demo.erl) | Store a binary artifact without terminal or text conversion. | [Buffers](../guides/buffers/) |
