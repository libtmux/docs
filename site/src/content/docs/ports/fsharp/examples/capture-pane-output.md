---
port: fsharp
route: examples/capture-pane-output
title: Capture pane output
description: Run a complete F# program that captures output on an isolated tmux server.
sidebar:
  label: Capture pane output
  group: Examples
  order: 3
tableOfContents: true
---

This complete F# program starts a private tmux server, sends a command,
and captures the line it prints. It includes imports, setup, and cleanup.
You need tmux 3.3a or newer and a Unix environment; no existing session is
required.

## Read what's on screen

The leading newline puts the output on a fresh row. Matching the whole line
avoids mistaking the echoed command for its output.

```fsharp title="Program.fs"
open System
open System.Collections.Generic
open System.Diagnostics
open System.IO
open System.Threading
open System.Threading.Tasks
open LibTmux
open LibTmux.FSharp

let capture () = task {
    let directory = Directory.CreateTempSubdirectory("libtmux-capture-")
    let errors = ResizeArray<exn>()
    let mutable owned: OwnedServerScope option = None
    let mutable stopped = false
    try
        use timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10.0))
        let token = timeout.Token
        let environment = Dictionary<string, string>()
        for name in [ "TMUX"; "TMUX_PANE"; "ENV"; "BASH_ENV" ] do
            environment[name] <- null
        let! scope = LibTmux.Server.CreateOwnedAsync(
            ServerConnectionOptions(
                SocketPath = Path.Combine(directory.FullName, "tmux.sock"),
                ConfigurationFile = "/dev/null",
                ChildEnvironment = environment), token)
        owned <- Some scope
        let! session = scope.Value.CreateSessionAsync(
            NewSessionRequest(Name = "capture", Command = "/bin/sh"), token)
        let! panes = session.GetPanesAsync(token)
        let pane = panes[0]
        do! pane |> Pane.sendKeys token (SendKeysRequest(
            Text = "printf '\\nlibtmux capture ready\\n'", Literal = true, Enter = true))

        let elapsed = Stopwatch.StartNew()
        let mutable captured = false
        while not captured && elapsed.Elapsed < TimeSpan.FromSeconds(5.0) do
            let! lines = pane |> Pane.capture token (CapturePaneRequest())
            captured <- Seq.contains "libtmux capture ready" lines
            if not captured then do! Task.Delay(25, token)
        if not captured then
            raise (TimeoutException("Output did not arrive within five seconds"))
        printfn "libtmux capture ready"
    with error -> errors.Add(error)

    // If stopping the server fails, keep its directory and socket.
    match owned with
    | Some scope ->
        try
            do! scope.DisposeAsync().AsTask()
            stopped <- true
        with error -> errors.Add(error)
    | None -> stopped <- not (File.Exists(Path.Combine(directory.FullName, "tmux.sock")))
    if stopped then
        try directory.Delete(true)
        with error -> errors.Add(error)
    if errors.Count > 0 then raise (AggregateException(errors))
}

[<EntryPoint>]
let main _ =
    try
        capture().GetAwaiter().GetResult()
        0
    with error ->
        eprintfn "%O" error
        1
```

<a id="wait-for-text-instead-of-guessing-a-delay"></a>

## Wait for output or completion

`Pane.sendKeys` and `Pane.capture` return tasks. The program stops its owned server after either success or failure. It reports cleanup errors alongside the original error and keeps the socket directory if stopping fails.

Capture reads screen state and scrollback, so output that has scrolled away
may be absent. The program prints `libtmux capture ready` when its check passes
and exits unsuccessfully if an operation fails.

## Setup and run

Use an empty directory and save the files using the displayed names. You need
the .NET 10 SDK. The project file installs `LibTmux.FSharp` 0.1.1 from NuGet.

Save `Capture.fsproj` beside `Program.fs`.

```xml title="Capture.fsproj"
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

```console
$ dotnet build Capture.fsproj --maxcpucount:1 &&
  dotnet run --project Capture.fsproj --no-build
```

<a id="source-inclusion"></a>

## Where this comes from

This program uses `LibTmux.FSharp` 0.1.1 from NuGet. Its [source](https://github.com/libtmux/libtmux-dotnet/tree/8d47af7d89638ad267528ac56897cec67df597f7/src/LibTmux.FSharp)
is on GitHub.
