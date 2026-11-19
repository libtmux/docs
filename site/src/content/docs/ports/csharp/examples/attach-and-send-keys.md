---
port: csharp
route: examples/attach-and-send-keys
title: Attach and send keys
description: Get a session handle, send a command to a pane, and capture output.
sidebar:
  label: Attach and send keys
  group: Examples
  order: 2
tableOfContents: true
---

Get a session handle, send a command to a pane, and capture output. These
examples use libtmux from your program; to attach your terminal interactively,
see [Attaching to tmux](/guides/attaching-to-tmux/).

The program creates a private tmux server with its own socket, so it never
touches a server you already run. It stops that server before it exits. [Setup
and run](#setup-and-run) lists what to install.

```csharp title="Program.cs"
using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using LibTmux;

if (OperatingSystem.IsWindows())
    throw new PlatformNotSupportedException("Use Linux or macOS");

DirectoryInfo directory = Directory.CreateTempSubdirectory("libtmux-attach-");
try
{
    using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(15));
    CancellationToken token = deadline.Token;

    // A server of its own on a private socket. Disposing the scope stops it.
    await using OwnedServerScope owned = await Server.CreateOwnedAsync(
        new ServerConnectionOptions
        {
            SocketPath = Path.Combine(directory.FullName, "tmux.sock"),
            ConfigurationFile = "/dev/null",
            ChildEnvironment = new Dictionary<string, string?>
            {
                ["TMUX"] = null,
                ["TMUX_PANE"] = null,
                ["ENV"] = null,
                ["BASH_ENV"] = null,
            },
        }, token);
    Server server = owned.Value;

    Session session = await server.CreateSessionAsync(
        new NewSessionRequest { Name = "build", Command = "/bin/sh" }, token);
    Window window = await session.CreateWindowAsync(
        new NewWindowRequest { Name = "tests", Command = "/bin/sh" }, token);
    Pane pane = (await window.GetPanesAsync(token))[0];
    Console.WriteLine($"{session.Name}:{window.Name} {pane.Id}");

    // The format string keeps the echoed command from matching the wait.
    PaneWaitResult result = await pane.SendTextAndWaitAsync(
        "printf 'hello from %s\\n' tmux", "hello from tmux",
        TimeSpan.FromSeconds(5), token);
    if (!result.Found)
        throw new TimeoutException("The pane did not print the line");
    Console.WriteLine("the pane printed it");

    foreach (string line in await pane.CaptureAsync(cancellationToken: token))
    {
        if (line.Length > 0)
            Console.WriteLine($"| {line}");
    }
}
finally
{
    directory.Delete(recursive: true);
}
```

## Finding an existing session instead

For a script that runs repeatedly, look up a session before creating it.
[Attaching to
tmux](/guides/attaching-to-tmux/#finding-a-session-instead-of-always-creating-one)
shows that pattern, and [Filtering and querying, in
practice](/guides/querying-and-filtering/) covers absent and ambiguous matches.

## Setup and run

Use an empty directory with tmux 3.3a or newer and the .NET 10 SDK. The project
file installs `LibTmux` 0.1.1 from NuGet. It disables implicit imports, so every
required import appears in the program.

Save the program as `Program.cs`. Save this file as `Attach.csproj`:

```xml title="Attach.csproj"
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>disable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="Program.cs" />
    <PackageReference Include="LibTmux" Version="0.1.1" />
  </ItemGroup>
</Project>
```

```console
$ dotnet build Attach.csproj --maxcpucount:1 &&
  dotnet run --project Attach.csproj --no-build
```

<a id="source-inclusion"></a>

## Where this comes from

This program uses `LibTmux` 0.1.1 from NuGet. Its [source](https://github.com/libtmux/libtmux-dotnet/tree/8d47af7d89638ad267528ac56897cec67df597f7/src/LibTmux)
is on GitHub.
