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

Use an empty directory on Linux with Git, tmux 3.2a or newer, and .NET SDK 10.0.302. Save the project files and launcher below, then save any complete program on this page. Each program has its own imports and entry point.

```xml title="Query.fsproj"
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <Example Condition="'$(Example)' == ''">Local</Example>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="$(Example).fs" />
    <ProjectReference Include="libtmux-source/src/LibTmux.FSharp/LibTmux.FSharp.fsproj" />
  </ItemGroup>
</Project>
```

The launcher creates two sessions on a private socket: `work-one` with an `editor` window, and `work-two` with a `logs` window. Each pane runs `cat` so it stays alive. It stops only this server when the program finishes or fails. If shutdown fails, it reports the retained directory and exits with an error.

```sh title="run.sh"
#!/bin/sh
set -eu

binary=$(command -v tmux)
mkdir -p /tmp/libtmux-dotnet-dev
directory=$(mktemp -d /tmp/libtmux-dotnet-dev/query.XXXXXX)
socket="$directory/tmux.sock"

cleanup() {
    status=$?
    trap - 0 HUP INT TERM
    if [ -S "$socket" ] && ! "$binary" -S "$socket" kill-server; then
        printf 'Cannot stop tmux; kept %s\n' "$directory" >&2
        exit 1
    fi
    rm -rf "$directory" || exit 1
    exit "$status"
}
trap cleanup 0
trap 'exit 1' HUP INT TERM

unset TMUX TMUX_PANE
export LIBTMUX_SOCKET_PATH="$socket" TMUX_BIN="$binary"
"$binary" -S "$socket" -f /dev/null new-session -d -s work-one -n editor /bin/cat
"$binary" -S "$socket" new-session -d -s work-two -n logs /bin/cat
"$@"
"$binary" -S "$socket" has-session -t '=work-one'
```

Fetch the library revision used by these examples:

```console
$ git clone https://github.com/libtmux/libtmux-dotnet libtmux-source &&
  git -C libtmux-source checkout 2d99ead5aba8d968e85dcac8c9a9a518452e6ba6
```

Each run starts from the same two-session fixture. Programs do not depend on another example having run first. Their assertions fail if the observed result differs.

## Run a bounded command and inspect its result

Read the session list and filter it locally. The connection uses a five-second timeout so an unavailable server fails visibly.

```fsharp title="Local.fs"
open System
open System.Threading
open System.Threading.Tasks
open LibTmux
open LibTmux.FSharp

let run () = task {
    let socket = Environment.GetEnvironmentVariable("LIBTMUX_SOCKET_PATH")
    if String.IsNullOrEmpty(socket) then
        invalidOp "Set LIBTMUX_SOCKET_PATH to an existing socket"
    use timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5.0))
    let token = timeout.Token
    let! server = LibTmux.Server.ConnectAsync(
        ServerConnectionOptions(SocketPath = socket), token)
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
$ dotnet build Query.fsproj --maxcpucount:1 -p:Example=Local \
  -p:DisableImplicitLibraryPacksFolder=true -p:RestorePackagesPath="$PWD/.packages" &&
  sh run.sh dotnet run --project Query.fsproj --no-build -p:Example=Local
```

Expected program output:

```text
work-one, work-two
```

## Open and close a control client

Send `list-sessions` over a persistent control connection, verify the response, then close the control client. A subsequent ordinary read verifies the tmux server still has both sessions.

```fsharp title="Control.fs"
open System
open System.Threading
open System.Threading.Tasks
open LibTmux
open LibTmux.FSharp

let run () = task {
    let socket = Environment.GetEnvironmentVariable("LIBTMUX_SOCKET_PATH")
    if String.IsNullOrEmpty(socket) then
        invalidOp "Set LIBTMUX_SOCKET_PATH to an existing socket"
    use timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5.0))
    let token = timeout.Token
    let! server = LibTmux.Server.ConnectAsync(
        ServerConnectionOptions(SocketPath = socket), token)
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
$ dotnet build Query.fsproj --maxcpucount:1 -p:Example=Control \
  -p:DisableImplicitLibraryPacksFolder=true -p:RestorePackagesPath="$PWD/.packages" &&
  sh run.sh dotnet run --project Query.fsproj --no-build -p:Example=Control
```

Expected program output:

```text
work-one, work-two
control client closed; server still running
```

## Timeouts and ownership

An operation that times out may already have reached tmux. Read the current state before retrying a mutation such as creating a window. A cancellation signal does not roll back a completed tmux command.

Here the launcher owns the private server and stops it after the program exits. An application connecting to an existing server should close its own client resources and leave that server running. See [attaching to tmux](../../guides/attaching-to-tmux/) for the connection-only example.
