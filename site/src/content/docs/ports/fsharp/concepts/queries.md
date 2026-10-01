---
port: fsharp
route: concepts/queries
title: Filtering and queries
description: Compose F# filters, distinguish zero and several matches, and query captured relations.
sidebar:
  label: Filtering and queries
  group: Concepts
  order: 4
tableOfContents: true
---

Filter captured objects in F#, handle result counts explicitly, and match sessions by their related windows. Local filters read captured values; they do not subscribe to changes or issue a fresh tmux query.

[`Filter`](../../reference/libtmux-fsharp-filter/) supplies equality, ordinal prefix matching and membership. Use `allOf`, `anyOf` and `negate` to compose conditions. [`Query.matching`](../../reference/libtmux-fsharp-query-matching/) materializes the matching objects in source order. Use `Seq.filter` for an application predicate that does not need a portable query.

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

## Match names and combine conditions

Select the two names beginning with `work-`, then assert equality, AND, OR and exclusion against the same captured collection. Matching is case sensitive. The native collection predicate agrees with the typed prefix query.

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

## Distinguish missing and ambiguous results

[`Selection.exactlyOne`](../../reference/libtmux-fsharp-selection-exactlyone/) returns a `Result`. Match `NoMatches` and `MultipleMatches` separately. A missing optional target and an ambiguous destructive target should not take the same path.

```fsharp title="Cardinality.fs"
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
    for name in [ "work-one"; "missing" ] do
        let matches = captured.Sessions |> Query.matching (Filter.eq name SessionFields.name)
        match matches |> Selection.exactlyOne with
        | Ok session -> printfn "%s: selected" session.Name
        | Error CardinalityError.NoMatches -> printfn "%s: absent" name
        | Error CardinalityError.MultipleMatches -> failwithf "Ambiguous session: %s" name
    let many = captured.Sessions |> Selection.exactlyOne
    match many with
    | Error CardinalityError.MultipleMatches -> printfn "work-: ambiguous"
    | _ -> failwith "Expected two sessions"
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
$ dotnet build Query.fsproj --maxcpucount:1 -p:Example=Cardinality \
  -p:DisableImplicitLibraryPacksFolder=true -p:RestorePackagesPath="$PWD/.packages" &&
  sh run.sh dotnet run --project Query.fsproj --no-build -p:Example=Cardinality
```

Expected program output:

```text
work-one: selected
missing: absent
work-: ambiguous
```

## Filter through related windows

Match sessions with any window named `editor`, then match sessions with none. For an empty captured relation, `any` is false and `none` is true; `all` is true. An uncaptured relation is a different condition and must be captured before filtering. This program derives the required snapshot depth from the query document.

```fsharp title="Relations.fs"
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
    let editor = Filter.eq "editor" WindowFields.name
    let withEditor = editor |> Filter.any SessionFields.windows
    let withoutEditor = editor |> Filter.none SessionFields.windows
    let depth = (Filter.toDocument withEditor).RequiredSnapshotDepth
    let! captured = server |> Server.capture token depth
    let selected = captured.Sessions |> Query.matching withEditor
    let excluded = captured.Sessions |> Query.matching withoutEditor
    if selected.Count <> 1 || selected[0].Name <> "work-one" then failwith "Wrong editor session"
    if excluded.Count <> 1 || excluded[0].Name <> "work-two" then failwith "Wrong other session"
    printfn "editor: %s" selected[0].Name
    printfn "no editor: %s" excluded[0].Name
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
$ dotnet build Query.fsproj --maxcpucount:1 -p:Example=Relations \
  -p:DisableImplicitLibraryPacksFolder=true -p:RestorePackagesPath="$PWD/.packages" &&
  sh run.sh dotnet run --project Query.fsproj --no-build -p:Example=Relations
```

Expected program output:

```text
editor: work-one
no editor: work-two
```

## Refresh before repeating a decision

Reusing the same list repeats the same decision over old state. Capture again when you need to observe a rename, new window or closed pane. The [snapshot example](../server-session-window-pane/#observe-a-rename-with-a-fresh-read) shows the old and fresh values side by side.
