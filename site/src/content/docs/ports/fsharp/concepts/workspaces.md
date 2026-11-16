---
port: fsharp
route: concepts/workspaces
title: Layouts and repeated setup
description: Create and reuse F# tmux layouts while preserving running processes.
sidebar:
  label: Layouts and repeated setup
  group: Concepts
  order: 6
tableOfContents: true
---

Build a tmux layout from F# by creating a window, splitting a pane and selecting a layout. Capture again to inspect the result. The examples use the library APIs directly and give every pane a command that stays alive.

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

## Create a two-pane tools window

Create `tools` in `work-one`, split its pane to the right, then choose `even-horizontal`. The final read verifies two panes. The previously captured session does not automatically gain the new window.

```fsharp title="Layout.fs"
open System
open System.IO
open System.Threading
open System.Threading.Tasks
open LibTmux
open LibTmux.FSharp

let example (server: LibTmux.Server) (token: CancellationToken) = task {
    let! captured = server |> Server.capture token SnapshotDepth.Sessions
    let session = captured.Sessions |> Seq.find (fun s -> s.Name = "work-one")
    let request = NewWindowRequest(Name = "tools", Command = "/bin/cat")
    let! window = session.CreateWindowAsync(request, token)
    let! panes = window.GetPanesAsync(token)
    let split = SplitPaneRequest(Direction = PaneDirection.Right, Command = "/bin/cat")
    let! _ = panes[0] |> Pane.split token split
    let! _ = window.SelectLayoutAsync(SelectLayoutRequest(Layout = "even-horizontal"), token)
    let! refreshed = window.GetPanesAsync(token)
    if refreshed.Count <> 2 then failwith "Expected two panes"
    printfn "tools: 2 panes"
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
$ dotnet build Query.fsproj --maxcpucount:1 -p:Example=Layout &&
  dotnet run --project Query.fsproj --no-build -p:Example=Layout
```

Expected program output:

```text
tools: 2 panes
```

## Reuse a named window

Look for `tools` before creating it. Two sequential calls return the same window ID, and the session has only `editor` and `tools`. This is useful for a setup command you run repeatedly.

```fsharp title="ReuseLayout.fs"
open System
open System.IO
open System.Threading
open System.Threading.Tasks
open LibTmux
open LibTmux.FSharp

let example (server: LibTmux.Server) (token: CancellationToken) = task {
    let ensureTools () = task {
        let! captured = server |> Server.capture token SnapshotDepth.Windows
        let session = captured.Sessions |> Seq.find (fun s -> s.Name = "work-one")
        match session.Windows |> Seq.tryFind (fun window -> window.Name = "tools") with
        | Some window -> return window
        | None ->
            return! session.CreateWindowAsync(
                NewWindowRequest(Name = "tools", Command = "/bin/cat"), token)
    }
    let! first = ensureTools ()
    let! second = ensureTools ()
    if first.Id <> second.Id then failwith "Created duplicate windows"
    let! captured = server |> Server.capture token SnapshotDepth.Windows
    let session = captured.Sessions |> Seq.find (fun s -> s.Name = "work-one")
    if session.Windows.Count <> 2 then failwith "Expected editor and tools windows"
    printfn "one tools window after two calls"
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
$ dotnet build Query.fsproj --maxcpucount:1 -p:Example=ReuseLayout &&
  dotnet run --project Query.fsproj --no-build -p:Example=ReuseLayout
```

Expected program output:

```text
one tools window after two calls
```

## Decide what repeated setup means

The reuse example preserves the existing window and its running processes. It does not reset its pane count, layout or commands. Choose that policy deliberately when building a reusable workspace command.

This check-then-create sequence assumes one writer. Concurrent callers can both observe an absent window and create duplicates. Serialize setup in your application when several callers share a session. A later failure also leaves earlier successful mutations in place; tmux commands are not a transaction.

Use [filtering and queries](../queries/) for stricter target selection and [captured handles](../server-session-window-pane/) to understand refresh behavior.
