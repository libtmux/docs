---
title: "Use the .NET workspace builder"
description: "Parse a workspace, build it on an owned server, and handle partial failures."
port: dotnet
product: workspace
sidebar:
  group: Internals
  label: Guides
  order: 2
tableOfContents: true
---

Use `WorkspaceFile.Parse` to read workspace YAML and `WorkspaceBuilder.BuildAsync`
to create its session, windows, and panes. Parsing needs no running tmux server;
building requires tmux on a Unix host.

Start with the [complete workspace example](../examples/). It includes the
program, project file, dependency checkout, and run command for the .NET 10 SDK.
The example creates a private server and removes it when the owned scope ends.

## Create an isolated workspace

Parse the YAML before opening the server. Create an owned scope with
`Server.CreateOwnedAsync`, passing a `ServerConnectionOptions` object with
the fresh socket name and configuration file. Pass the scope's server to
`WorkspaceBuilder`, then await `BuildAsync` with a cancellation token. Use
`await using` so the scope is disposed even when building throws.

The returned `WorkspaceResult` identifies the session and its windows.
Inspect `Unsupported` for layouts that tmux rejected after creating their
windows. Keep the owned scope alive while your application uses the workspace;
disposing it removes its server and the sessions on that server.

## Read a file and handle errors

Read the YAML file as text and pass it to `WorkspaceFile.Parse`.
Resolve relative working directories yourself if they
should be based on that file's location.

For an existing application server, pass its handle to `WorkspaceBuilder`
instead of creating an owned scope. A failed build can leave a partial session.
Inspect `WorkspaceBuildException.PartialResult` and decide what to remove;
the builder does not roll back changes automatically.

The [builder source](https://github.com/libtmux/libtmux-dotnet/blob/320dc64f4b8b7815842471327a5e6b84a1499bf8/src/LibTmux.Workspace/WorkspaceBuilder.cs)
describes the build result and partial-failure behavior. See
[owned server lifetime](https://github.com/libtmux/libtmux-dotnet/blob/320dc64f4b8b7815842471327a5e6b84a1499bf8/src/LibTmux/Server.Lifecycle.cs)
for scope cleanup.
