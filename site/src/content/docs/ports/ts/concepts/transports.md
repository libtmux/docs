---
port: ts
route: concepts/transports
title: Control mode vs one-shot
description: Choose subprocesses, command batches, or persistent connections to send commands and receive events.
sidebar:
  label: Control mode vs one-shot
  group: Concepts
  order: 3
tableOfContents: true
---

libtmux sends commands to tmux through subprocesses or persistent control-mode
connections. tmux also accepts several commands in one invocation:

1. **One-shot subprocess.** Each command spawns a fresh `tmux` process,
   which sends the request to the server, prints the result, and exits.
2. **A persistent control-mode client.** `tmux -C attach-session` starts one
   long-lived tmux process that stays attached and speaks a line-oriented
   protocol over its stdout: commands go in, replies and asynchronous
   notifications (`%window-add`, `%output`, ...) come out, without starting a
   process per call.
3. **One invocation, several commands.** tmux accepts more than one command
   per invocation (`;`-joined, or one `-F`-tagged `list-*` per line). Grouping
   operations this way reduces process starts without opening a control-mode
   connection.

<a id="where-each-port-draws-the-line"></a>

## Available transports

Commands use a subprocess by default. `pipeline()` and `batch()` group
operations. `connect()` and `watch()` keep a connection for notifications;
ordinary commands still use separate processes.

Choose based on whether you need command results, notifications, or a batch of
changes.

## Notifications and commands are separable

TypeScript's `connect()` adds an event observer while commands such as
`session.newWindow(...)` and `pane.sendKeys(...)` continue to run as separate
tmux processes. A dedicated process provides a completion boundary for output
from alias-expanded or waiting commands.

## A control client is a real client

A persistent control connection attaches a tmux client. It appears in
`list-clients`, increments `session_attached`, and affects `destroy-unattached`,
client hooks, and idle-client accounting. Each connection counts separately.

## Why fold several commands into one invocation

Creating an object can require a second command to read its resulting state.
Batching can reduce repeated reads and process starts.

`batch()` resolves planned mutations from one final snapshot.

<a id="choosing-a-lane"></a>

## What this costs in practice

A persistent connection avoids starting a client for each command. A chain
groups a known sequence into one invocation. For occasional commands, use the
default subprocess transport; measure your workload before changing transports
for performance. Use a notification stream when your program needs tmux events.

## Sending a command

The example uses the subprocess API. See the reference for batching and
control-mode setup.

```typescript
import { Server } from "libtmux";

// Each awaited command uses a tmux subprocess.
const server = new Server();
const session = await server.newSession({ name: "work" });
const editor = await session.newWindow({ name: "editor" });
await editor.panes.at(0)?.sendKeys("echo hello");
```

To inspect tmux's control protocol, attach a control client:

```console
$ tmux -C attach-session -t work
```
