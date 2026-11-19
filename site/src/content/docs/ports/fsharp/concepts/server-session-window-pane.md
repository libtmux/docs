---
port: fsharp
route: concepts/server-session-window-pane
title: Server, session, window, pane
description: Traverse captured F# handles, retain IDs and refresh after changes.
sidebar:
  label: Server, session, window, pane
  group: Concepts
  order: 2
tableOfContents: true
---

Capture a hierarchy, then read its sessions, windows and panes locally. Handles retain the state they captured; a rename does not rewrite an older handle. Use a new capture to observe later changes.

[`Server`](../../reference/libtmux-fsharp-server/) is the F# helper module. It operates on the underlying [`LibTmux.Server`](../../../../csharp/latest/reference/libtmux-server/) object. Choose a snapshot depth before traversal: sessions, windows or panes. A relation that was not captured is unavailable, rather than an empty collection.

A session holds window placements; a window holds panes. A linked window can appear in several sessions, so traversal counts placements rather than necessarily distinct physical windows. Names can change; retain IDs when identifying a target.

## Setup and run

Use an empty directory on Linux with tmux 3.3a or newer and the .NET 10 SDK. The project file installs [`LibTmux.FSharp`](https://www.nuget.org/packages/LibTmux.FSharp/0.1.1) 0.1.1 from NuGet ([source](https://github.com/libtmux/libtmux-dotnet/tree/8d47af7d89638ad267528ac56897cec67df597f7/src/LibTmux.FSharp)). Save the project file below, then save any complete program on this page. Each program has its own imports and entry point.

```xml title="Query.fsproj"
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <Example Condition="'$(Example)' == ''">Local</Example>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="$(Example).fs" />
    <PackageReference Include="LibTmux.FSharp" Version="0.1.1" />
  </ItemGroup>
</Project>
```

Each program starts a private tmux server in a new temporary directory and creates two sessions: `work-one` with an `editor` window, and `work-two` with a `logs` window. Each pane runs `cat` so it stays alive. The program connects to that socket by path, runs its example, and stops only that server when it finishes or fails. If tmux cannot be stopped, the program keeps the directory and prints its location.

Each run starts from the same two-session fixture. Programs do not depend on another example having run first. Their assertions fail if the observed result differs.

## Walk sessions, windows and panes

Flatten the captured children and verify the fixture contains two of each. The program also prints each session and its window.

```fsharp title="Hierarchy.fs"
open System
open System.IO
open System.Threading
open System.Threading.Tasks
open LibTmux
open LibTmux.FSharp

let example (server: LibTmux.Server) (token: CancellationToken) = task {
    let! captured = server |> Server.capture token SnapshotDepth.Panes
    let sessions = captured.Sessions
    let windows = sessions |> Seq.collect (fun session -> session.Windows) |> Seq.toList
    let panes = windows |> Seq.collect (fun window -> window.Panes) |> Seq.toList
    if sessions.Count <> 2 || windows.Length <> 2 || panes.Length <> 2 then
        failwith "Unexpected hierarchy"
    for session in sessions do
        printfn "%s: %s" session.Name session.Windows[0].Name
    printfn "2 sessions, 2 windows, 2 panes"
}

let run () = task {
    let directory = Directory.CreateTempSubdirectory("libtmux-example-")
    let mutable owned: OwnedServerScope = null
    try
        use timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10.0))
        let token = timeout.Token
        let socket = Path.Combine(directory.FullName, "tmux.sock")
        let options =
            ServerConnectionOptions(
                SocketPath = socket, ConfigurationFile = "/dev/null")
        let! scope = LibTmux.Server.CreateOwnedAsync(options, token)
        owned <- scope
        for name, window in [ "work-one", "editor"; "work-two", "logs" ] do
            let request =
                NewSessionRequest(
                    Name = name, WindowName = window, Command = "/bin/cat")
            let! _ = scope.Value.CreateSessionAsync(request, token)
            ()
        let! server = LibTmux.Server.ConnectAsync(
            ServerConnectionOptions(SocketPath = socket), token)
        do! example server token
    finally
        if not (isNull owned) then
            try owned.DisposeAsync().AsTask().GetAwaiter().GetResult()
            with _ ->
                eprintfn "Cannot stop tmux; kept %s" directory.FullName
                reraise ()
        directory.Delete(true)
}

[<EntryPoint>]
let main _ =
    try
        run().GetAwaiter().GetResult()
        0
    with error ->
        eprintfn "%O" error
        1
```

```console
$ dotnet build Query.fsproj --maxcpucount:1 -p:Example=Hierarchy &&
  dotnet run --project Query.fsproj --no-build -p:Example=Hierarchy
```

Expected program output:

```text
work-one: editor
work-two: logs
2 sessions, 2 windows, 2 panes
```

## Observe a rename with a fresh read

Rename the editor window. The old handle still says `editor`; the returned handle and a new server read say `renamed`. This distinction matters when a UI, another client or your own code changes tmux after a capture.

```fsharp title="Refresh.fs"
open System
open System.IO
open System.Threading
open System.Threading.Tasks
open LibTmux
open LibTmux.FSharp

let example (server: LibTmux.Server) (token: CancellationToken) = task {
    let! captured = server |> Server.capture token SnapshotDepth.Windows
    let session = captured.Sessions |> Seq.find (fun session -> session.Name = "work-one")
    let before = session.Windows[0]
    let! after = before.RenameAsync("renamed", token)
    if before.Name <> "editor" || after.Name <> "renamed" then failwith "Unexpected rename state"
    let! refreshed = server |> Server.capture token SnapshotDepth.Windows
    let session = refreshed.Sessions |> Seq.find (fun s -> s.Name = "work-one")
    let window = session.Windows[0]
    if window.Name <> "renamed" then failwith "Fresh read did not see the rename"
    printfn "%s -> %s" before.Name window.Name
}

let run () = task {
    let directory = Directory.CreateTempSubdirectory("libtmux-example-")
    let mutable owned: OwnedServerScope = null
    try
        use timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10.0))
        let token = timeout.Token
        let socket = Path.Combine(directory.FullName, "tmux.sock")
        let options =
            ServerConnectionOptions(
                SocketPath = socket, ConfigurationFile = "/dev/null")
        let! scope = LibTmux.Server.CreateOwnedAsync(options, token)
        owned <- scope
        for name, window in [ "work-one", "editor"; "work-two", "logs" ] do
            let request =
                NewSessionRequest(
                    Name = name, WindowName = window, Command = "/bin/cat")
            let! _ = scope.Value.CreateSessionAsync(request, token)
            ()
        let! server = LibTmux.Server.ConnectAsync(
            ServerConnectionOptions(SocketPath = socket), token)
        do! example server token
    finally
        if not (isNull owned) then
            try owned.DisposeAsync().AsTask().GetAwaiter().GetResult()
            with _ ->
                eprintfn "Cannot stop tmux; kept %s" directory.FullName
                reraise ()
        directory.Delete(true)
}

[<EntryPoint>]
let main _ =
    try
        run().GetAwaiter().GetResult()
        0
    with error ->
        eprintfn "%O" error
        1
```

```console
$ dotnet build Query.fsproj --maxcpucount:1 -p:Example=Refresh &&
  dotnet run --project Query.fsproj --no-build -p:Example=Refresh
```

Expected program output:

```text
editor -> renamed
```

## Select a target before changing it

A successful lookup does not reserve a tmux object. Another client can remove it before your next command. Handle a command failure at the mutation, and refresh before deciding what to do next. See [filtering and queries](../queries/) for missing and ambiguous selections, and [layouts](../workspaces/) for creation.
