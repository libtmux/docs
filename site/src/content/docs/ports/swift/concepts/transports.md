---
port: swift
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

Ordinary calls use subprocesses. `Server.connected(attachingTo:_:)` provides
a persistent connection, and `ControlConnection.watch(_:)` receives events.

Choose based on whether you need command results, notifications, or a batch of
changes.

## A control client is a real client

A persistent control connection attaches a tmux client. It appears in
`list-clients`, increments `session_attached`, and affects `destroy-unattached`,
client hooks, and idle-client accounting. Each connection counts separately.

## Why fold several commands into one invocation

Creating an object can require a second command to read its resulting state.
Batching can reduce repeated reads and process starts.

<a id="choosing-a-lane"></a>

## What this costs in practice

A persistent connection avoids starting a client for each command. A chain
groups a known sequence into one invocation. For occasional commands, use the
default subprocess transport; measure your workload before changing transports
for performance. Use a notification stream when your program needs tmux events.

## Sending a command

The example uses the subprocess API. See the reference for batching and
control-mode setup.

```swift
import LibTmux

// One-shot: every call underneath this handle spawns a `tmux` process.
let server = try Server(socketName: "default")
let session = try await server.newSession(named: "work", windowName: "editor")
let window = try await server.newWindow(in: session, named: "logs").window
let pane = try await server.splitWindow(window, direction: .right)
try await server.run("echo hello", in: pane)
```

To inspect tmux's control protocol, attach a control client:

```console
$ tmux -C attach-session -t work
```
