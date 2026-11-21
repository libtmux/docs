---
port: fsharp
route: guides/attaching-to-tmux
title: Attaching to tmux
description: Connect to an existing tmux server and find a session with F#.
sidebar:
  label: Attaching to tmux
  group: Guides
  order: 3
tableOfContents: true
---

Connect a `Server` to an explicit socket and find the existing `work` session.
The program prints its name and leaves the tmux server running. It reports an
error if the connection fails or the session is absent.

This controls tmux from your program. To open a session in your terminal, use
`tmux attach-session`; the [shared guide](../../../../tmux/guides/attaching-to-tmux/) covers
interactive attachment and detaching.

<a id="which-socket-a-bare-constructor-reaches"></a>

## Connect to an existing server

Save the complete program as `Program.fs`. When `LIBTMUX_SOCKET_PATH` names a
socket, `findWork` connects a `Server` to it, finds `work`, prints the name and
leaves that server running.

Without the variable, `demonstrate` starts a private tmux server in a new
temporary directory and creates a detached `work` session in it. It then
connects a second `Server` to the socket by path and runs the same lookup. The
`finally` block stops only the private server and removes its directory. If
tmux cannot be stopped, the program keeps the directory and prints its location.

```fsharp title="Program.fs" role="program"
open System
open System.IO
open System.Threading
open System.Threading.Tasks
open LibTmux

let findWork (socket: string) (token: CancellationToken) = task {
    let! server = Server.ConnectAsync(
        ServerConnectionOptions(SocketPath = socket), token)
    let! exists = server.HasSessionAsync("work", cancellationToken = token)
    if not exists then invalidOp "The work session does not exist"
    printfn "work"
}

let demonstrate (token: CancellationToken) = task {
    let directory = Directory.CreateTempSubdirectory("libtmux-attach-")
    let mutable owned: OwnedServerScope = null
    try
        let socket = Path.Combine(directory.FullName, "tmux.sock")
        let options =
            ServerConnectionOptions(
                SocketPath = socket, ConfigurationFile = "/dev/null")
        let! scope = Server.CreateOwnedAsync(options, token)
        owned <- scope
        let request = NewSessionRequest(Name = "work", Command = "/bin/cat")
        let! _ = scope.Value.CreateSessionAsync(request, token)
        do! findWork socket token
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
        use timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10.0))
        let existing = Environment.GetEnvironmentVariable("LIBTMUX_SOCKET_PATH")
        let work =
            if String.IsNullOrEmpty(existing) then demonstrate timeout.Token
            else findWork existing timeout.Token
        work.GetAwaiter().GetResult()
        0
    with error ->
        eprintfn "%O" error
        1
```

## Setup and run

Use an empty directory on Linux with tmux 3.3a or newer installed. The project
file installs [`LibTmux.FSharp`](https://www.nuget.org/packages/LibTmux.FSharp/0.1.1) 0.1.1 from NuGet ([source](https://github.com/libtmux/libtmux-dotnet/tree/8d47af7d89638ad267528ac56897cec67df597f7/src/LibTmux.FSharp)).

This example was checked with .NET SDK 10.0.403.

Save this file beside the program using the displayed filename.

```xml title="Connect.fsproj"
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="Program.fs" />
    <PackageReference Include="LibTmux.FSharp" Version="0.1.1" />
  </ItemGroup>
</Project>
```

Build and run:

```console
$ dotnet build Connect.fsproj --maxcpucount:1 &&
  dotnet run --project Connect.fsproj --no-build
```

The program prints `work`. To use an existing server of your own, set
`LIBTMUX_SOCKET_PATH` to its socket before running the program; the program
leaves that server running.

<a id="finding-a-session-instead-of-always-creating-one"></a>

## Find or create a session

The example only looks up a session. If your application creates a session
after an unsuccessful lookup, another client may create the same name between
those operations. Handle the creation error instead of assuming the lookup
reserves the name.

For a complete program that starts and owns its server, see
[Capture pane output](/examples/capture-pane-output/).
