---
title: "Build a .NET workspace"
description: "Install LibTmux.Workspace and build a session with typed results."
port: dotnet
product: workspace
sidebar:
  label: Guides
  order: 2
tableOfContents: true
---

Install the workspace package in a .NET console project. With the .NET 10 SDK,
add the current prerelease:

```console
$ dotnet package add LibTmux.Workspace --prerelease
```

Retain the resolved version in the project or central package file. Building
requires tmux on the host; parsing YAML does not.

## Create an isolated workspace

Replace the console application's program with this example. The owned server
scope selects a fresh socket and removes that server when disposed, including
if building throws.

```csharp
using LibTmux;
using LibTmux.Workspace;

if (OperatingSystem.IsWindows())
    throw new PlatformNotSupportedException("This example requires tmux on Unix.");

WorkspaceFile workspace = WorkspaceFile.Parse("""
    session_name: guide
    windows:
      - window_name: editor
        panes:
          - shell_command: echo ready
      - window_name: server
        panes:
          - shell_command: echo serving
    """);

await using var owned = await Server.CreateOwnedAsync(
    new ServerConnectionOptions(socketName: $"workspace-{Guid.NewGuid():N}"));
WorkspaceResult result = await new WorkspaceBuilder(owned.Value)
    .BuildAsync(workspace);
Console.WriteLine($"{result.Session.Name}: {result.Windows.Count} windows");
foreach (string unsupported in result.Unsupported)
    Console.WriteLine(unsupported);
```

Run the console project:

```console
$ dotnet run
```

## Read a file and handle errors

Pass `File.ReadAllText("session.yaml")` to `WorkspaceFile.Parse` to load a
file. Resolve relative working directories yourself if they should be based
on the file's location.

For an existing application server, pass its handle to `WorkspaceBuilder`
instead of creating an owned scope. Keep the returned session running for as
long as your application needs it. Inspect
`WorkspaceBuildException.PartialResult`
after a failure and decide what to remove; the builder has no automatic
rollback.

[Builder API](https://github.com/libtmux/libtmux-dotnet/blob/8bf692bd33869e0c572a446310e96c771c9c07fd/src/LibTmux.Workspace/WorkspaceBuilder.cs); [Owned server lifetime](https://github.com/libtmux/libtmux-dotnet/blob/8bf692bd33869e0c572a446310e96c771c9c07fd/src/LibTmux/Server.Lifecycle.cs).
