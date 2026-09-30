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
`tmux attach-session`; the [shared guide](../../../../guides/attaching-to-tmux/) covers
interactive attachment and detaching.

<a id="which-socket-a-bare-constructor-reaches"></a>

## Connect to an existing server

Save the complete program as `Program.fs`. `LIBTMUX_SOCKET_PATH` selects
the existing server. The launcher below supplies a private socket for trying
the example.

```fsharp title="Program.fs"
open System
open System.Threading
open System.Threading.Tasks
open LibTmux

let connect () = task {
    let socket = Environment.GetEnvironmentVariable("LIBTMUX_SOCKET_PATH")
    if String.IsNullOrEmpty(socket) then
        invalidOp "Set LIBTMUX_SOCKET_PATH to an existing socket"
    use timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5.0))
    let! server = Server.ConnectAsync(
        ServerConnectionOptions(SocketPath = socket), timeout.Token)
    let! exists = server.HasSessionAsync("work", cancellationToken = timeout.Token)
    if not exists then invalidOp "The work session does not exist"
    printfn "work"
}

[<EntryPoint>]
let main _ =
    try
        connect().GetAwaiter().GetResult()
        0
    with error ->
        eprintfn "%O" error
        1
```

## Setup and run

Use an empty directory on Linux with Git and tmux 3.2a or newer installed.

This example was checked with .NET SDK 10.0.302.

Save this file beside the program using the displayed filename.

```xml title="Connect.fsproj"
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="Program.fs" />
    <ProjectReference Include="libtmux-source/src/LibTmux.FSharp/LibTmux.FSharp.fsproj" />
  </ItemGroup>
</Project>
```

Save the launcher as `run.sh`. It starts an isolated tmux server, runs the
program, checks that the session still exists, then stops only that server.
Cleanup runs after failures too. A failed shutdown keeps its socket directory
and prints its location for inspection.

```sh title="run.sh"
#!/bin/sh
set -eu

binary=$(command -v tmux)
directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-fsharp-attach.XXXXXX")
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
"$binary" -S "$socket" -f /dev/null new-session -d -s work /bin/cat
"$@"
"$binary" -S "$socket" has-session -t '=work'
```

Fetch the verified library revision, build, and run:

```console
$ git clone https://github.com/libtmux/libtmux-dotnet libtmux-source &&
  git -C libtmux-source checkout 661287848a6cfb407f37114b25e8249a29f99e3f &&
  dotnet build Connect.fsproj --maxcpucount:1 \
    -p:DisableImplicitLibraryPacksFolder=true \
    -p:RestorePackagesPath="$PWD/.packages" &&
  sh run.sh dotnet run --project Connect.fsproj --no-build
```

The program prints `work`. To use an existing server of your own, set
`LIBTMUX_SOCKET_PATH` to its socket and run the program without the launcher.
That launcher is responsible for the demonstration server's lifetime.

<a id="finding-a-session-instead-of-always-creating-one"></a>

## Find or create a session

The example only looks up a session. If your application creates a session
after an unsuccessful lookup, another client may create the same name between
those operations. Handle the creation error instead of assuming the lookup
reserves the name.

For a complete program that starts and owns its server, see
[Capture pane output](/examples/capture-pane-output/).
