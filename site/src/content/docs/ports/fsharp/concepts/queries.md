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

## Match names and combine conditions

Select the two names beginning with `work-`, then assert equality, AND, OR and exclusion against the same captured collection. Matching is case sensitive. The native collection predicate agrees with the typed prefix query.

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

## Distinguish missing and ambiguous results

[`Selection.exactlyOne`](../../reference/libtmux-fsharp-selection-exactlyone/) returns a `Result`. Match `NoMatches` and `MultipleMatches` separately. A missing optional target and an ambiguous destructive target should not take the same path.

```fsharp title="Cardinality.fs"
open System
open System.IO
open System.Threading
open System.Threading.Tasks
open LibTmux
open LibTmux.FSharp

let example (server: LibTmux.Server) (token: CancellationToken) = task {
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
$ dotnet build Query.fsproj --maxcpucount:1 -p:Example=Cardinality &&
  dotnet run --project Query.fsproj --no-build -p:Example=Cardinality
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
open System.IO
open System.Threading
open System.Threading.Tasks
open LibTmux
open LibTmux.FSharp

let example (server: LibTmux.Server) (token: CancellationToken) = task {
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
$ dotnet build Query.fsproj --maxcpucount:1 -p:Example=Relations &&
  dotnet run --project Query.fsproj --no-build -p:Example=Relations
```

Expected program output:

```text
editor: work-one
no editor: work-two
```

## Refresh before repeating a decision

Reusing the same list repeats the same decision over old state. Capture again when you need to observe a rename, new window or closed pane. The [snapshot example](../server-session-window-pane/#observe-a-rename-with-a-fresh-read) shows the old and fresh values side by side.
