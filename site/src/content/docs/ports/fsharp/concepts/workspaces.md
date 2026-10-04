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
    <ProjectReference
      Include="libtmux-source/src/LibTmux.FSharp/LibTmux.FSharp.fsproj" />
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
"$binary" -S "$socket" -f /dev/null \
    new-session -d -s work-one -n editor /bin/cat
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

## Create a two-pane tools window

Create `tools` in `work-one`, split its pane to the right, then choose `even-horizontal`. The final read verifies two panes. The previously captured session does not automatically gain the new window.

```fsharp title="Layout.fs"
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
    let session = captured.Sessions |> Seq.find (fun s -> s.Name = "work-one")
    let request = NewWindowRequest(Name = "tools", Command = "/bin/cat")
    let! window = session.CreateWindowAsync(request, token)
    let! panes = window.GetPanesAsync(token)
    let split =
        SplitPaneRequest(Direction = PaneDirection.Right, Command = "/bin/cat")
    let! _ = panes[0] |> Pane.split token split
    let layout = SelectLayoutRequest(Layout = "even-horizontal")
    let! _ = window.SelectLayoutAsync(layout, token)
    let! refreshed = window.GetPanesAsync(token)
    if refreshed.Count <> 2 then failwith "Expected two panes"
    printfn "tools: 2 panes"
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
$ dotnet build Query.fsproj --maxcpucount:1 -p:Example=Layout \
    -p:DisableImplicitLibraryPacksFolder=true \
    -p:RestorePackagesPath="$PWD/.packages" &&
  sh run.sh dotnet run --project Query.fsproj --no-build -p:Example=Layout
```

Expected program output:

```text
tools: 2 panes
```

## Reuse a named window

Look for `tools` before creating it. Two sequential calls return the same window ID, and the session has only `editor` and `tools`. This is useful for a setup command you run repeatedly.

```fsharp title="ReuseLayout.fs"
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
    let ensureTools () = task {
        let! captured = server |> Server.capture token SnapshotDepth.Windows
        let session =
            captured.Sessions |> Seq.find (fun s -> s.Name = "work-one")
        let tools = session.Windows |> Seq.tryFind (fun w -> w.Name = "tools")
        match tools with
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
    if session.Windows.Count <> 2 then
        failwith "Expected editor and tools windows"
    printfn "one tools window after two calls"
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
$ dotnet build Query.fsproj --maxcpucount:1 -p:Example=ReuseLayout \
    -p:DisableImplicitLibraryPacksFolder=true \
    -p:RestorePackagesPath="$PWD/.packages" &&
  sh run.sh dotnet run --project Query.fsproj --no-build -p:Example=ReuseLayout
```

Expected program output:

```text
one tools window after two calls
```

## Decide what repeated setup means

The reuse example preserves the existing window and its running processes. It does not reset its pane count, layout or commands. Choose that policy deliberately when building a reusable workspace command.

This check-then-create sequence assumes one writer. Concurrent callers can both observe an absent window and create duplicates. Serialize setup in your application when several callers share a session. A later failure also leaves earlier successful mutations in place; tmux commands are not a transaction.

Use [filtering and queries](../queries/) for stricter target selection and [captured handles](../server-session-window-pane/) to understand refresh behavior.
