---
port: fsharp
route: concepts/transports
title: Commands and control mode
description: Use F# command calls and persistent control connections with explicit cleanup.
sidebar:
  label: Commands and control mode
  group: Concepts
  order: 5
tableOfContents: true
---

Choose command calls for bounded operations and a control connection when you need a persistent tmux client. Closing a client releases its resources; it does not mean the tmux server should be stopped.

[`Server.capture`](../../reference/libtmux-fsharp-server-capture/) returns a task and takes an explicit cancellation token. The default connection executes command requests through subprocesses. [`Control.withSession`](../../reference/libtmux-fsharp-control-withsession/) brackets a persistent control session and closes it when the callback finishes.

## Setup and run

Use an empty directory on Linux with tmux 3.3a or newer and the .NET 10 SDK. The control connection program needs tmux 3.7 or newer; older releases refuse it. The project file installs [`LibTmux.FSharp`](https://www.nuget.org/packages/LibTmux.FSharp/0.1.1) 0.1.1 from NuGet ([source](https://github.com/libtmux/libtmux-dotnet/tree/8d47af7d89638ad267528ac56897cec67df597f7/src/LibTmux.FSharp)). Save the project file below, then save any complete program on this page. Each program has its own imports and entry point.

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

## Run a bounded command and inspect its result

Read the session list and filter it locally. The program bounds startup, connection and reads with a ten-second timeout so an unavailable server fails visibly.

```fsharp title="Local.fs"
open System
open System.IO
open System.Threading
open System.Threading.Tasks
open LibTmux
open LibTmux.FSharp

let example (server: LibTmux.Server) (token: CancellationToken) = task {
    let! captured = server |> Server.capture token SnapshotDepth.Sessions
    let prefix = Filter.startsWith "work-" SessionFields.name
    let matching = captured.Sessions |> Query.matching prefix
    let names = matching |> Seq.map (fun session -> session.Name) |> Seq.sort |> Seq.toList
    if names <> [ "work-one"; "work-two" ] then failwith "Unexpected sessions"
    printfn "%s" (String.concat ", " names)
    let native = captured.Sessions |> Seq.filter (fun session -> session.Name.StartsWith("work-"))
    if Seq.length native <> matching.Count then failwith "Local filters disagree"
    let onlyOne = Filter.allOf [
        Filter.startsWith "work-" SessionFields.name
        Filter.eq "work-one" SessionFields.name
    ]
    let selected = captured.Sessions |> Query.matching onlyOne
    if selected.Count <> 1 || selected[0].Name <> "work-one" then failwith "Wrong AND result"
    let either = Filter.oneOf [ "work-one"; "work-two" ] SessionFields.name
    if (captured.Sessions |> Query.matching either).Count <> 2 then failwith "Wrong OR result"
    let excluded = Filter.eq "work-one" SessionFields.name |> Filter.negate
    let remaining = captured.Sessions |> Query.matching excluded
    if remaining.Count <> 1 || remaining[0].Name <> "work-two" then failwith "Wrong NOT result"
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
$ dotnet build Query.fsproj --maxcpucount:1 -p:Example=Local &&
  dotnet run --project Query.fsproj --no-build -p:Example=Local
```

Expected program output:

```text
work-one, work-two
```

## Open and close a control client

Send `list-sessions` over a persistent control connection, verify the response, then close the control client. A subsequent ordinary read verifies the tmux server still has both sessions.

```fsharp title="Control.fs"
open System
open System.IO
open System.Threading
open System.Threading.Tasks
open LibTmux
open LibTmux.FSharp

let example (server: LibTmux.Server) (token: CancellationToken) = task {
    do! server |> Control.withSession token (fun control -> task {
        let command = TmuxCommand.Create("list-sessions", "-F", "#{session_name}")
        let! lines = control.SendAsync(command, token)
        let names = lines |> Seq.sort |> Seq.toList
        if names <> [ "work-one"; "work-two" ] then failwith "Unexpected sessions"
        printfn "%s" (String.concat ", " names)
    })
    let! captured = server |> Server.capture token SnapshotDepth.Sessions
    if captured.Sessions.Count <> 2 then failwith "Server lost its sessions"
    printfn "control client closed; server still running"
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
$ dotnet build Query.fsproj --maxcpucount:1 -p:Example=Control &&
  dotnet run --project Query.fsproj --no-build -p:Example=Control
```

Expected program output:

```text
work-one, work-two
control client closed; server still running
```

## Timeouts and ownership

An operation that times out may already have reached tmux. Read the current state before retrying a mutation such as creating a window. A cancellation signal does not roll back a completed tmux command.

Here each program owns the private server and stops it after its work is done. An application connecting to an existing server should close its own client resources and leave that server running. See [attaching to tmux](../../guides/attaching-to-tmux/) for the connection-only example.
