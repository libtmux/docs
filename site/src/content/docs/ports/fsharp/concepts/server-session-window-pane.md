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

## Walk sessions, windows and panes

Flatten the captured children and verify the fixture contains two of each. The program also prints each session and its window.

```fsharp title="Hierarchy.fs"
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
$ dotnet build Query.fsproj --maxcpucount:1 -p:Example=Hierarchy \
  -p:DisableImplicitLibraryPacksFolder=true -p:RestorePackagesPath="$PWD/.packages" &&
  sh run.sh dotnet run --project Query.fsproj --no-build -p:Example=Hierarchy
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
$ dotnet build Query.fsproj --maxcpucount:1 -p:Example=Refresh \
  -p:DisableImplicitLibraryPacksFolder=true -p:RestorePackagesPath="$PWD/.packages" &&
  sh run.sh dotnet run --project Query.fsproj --no-build -p:Example=Refresh
```

Expected program output:

```text
editor -> renamed
```

## Select a target before changing it

A successful lookup does not reserve a tmux object. Another client can remove it before your next command. Handle a command failure at the mutation, and refresh before deciding what to do next. See [filtering and queries](../queries/) for missing and ambiguous selections, and [layouts](../workspaces/) for creation.
