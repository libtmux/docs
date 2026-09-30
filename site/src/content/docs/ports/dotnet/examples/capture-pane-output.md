---
port: dotnet
route: examples/capture-pane-output
title: Capture pane output
description: Run a complete program that captures a pane and waits for a complete output line.
sidebar:
  label: Capture pane output
  group: Examples
  order: 3
tableOfContents: true
---

A pane runs asynchronously: sending a command does not mean its output is
already on screen. Capture repeatedly until the expected line appears, with a
deadline so a failed command cannot leave the program waiting forever.

This complete program creates a private tmux server, captures its output, and
cleans up. Follow the [setup and run instructions](#setup-and-run) below. You need
tmux and a Unix environment; no existing tmux session is required.

## Read what's on screen

The program sends `printf` with a leading newline, then waits for the complete
line `libtmux capture ready`. The newline keeps a late shell prompt off that
line. Matching the whole line avoids mistaking the echoed command for its output.

```csharp title="Program.cs"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using LibTmux;

if (OperatingSystem.IsWindows())
    throw new PlatformNotSupportedException("Run this example on Linux or macOS");

string directory = Path.Combine(
    "/tmp/libtmux-dotnet-dev", Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(directory);
try
{
    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
    CancellationToken token = timeout.Token;
    await using OwnedServerScope owned = await Server.CreateOwnedAsync(
        new ServerConnectionOptions
        {
            SocketPath = Path.Combine(directory, "tmux.sock"),
            ConfigurationFile = "/dev/null",
            ChildEnvironment = new Dictionary<string, string?>
            {
                ["TMUX"] = null,
                ["TMUX_PANE"] = null,
                ["ENV"] = null,
                ["BASH_ENV"] = null,
            },
        }, token);
    Session session = await owned.Value.CreateSessionAsync(
        new NewSessionRequest { Name = "capture", Command = "/bin/sh" }, token);
    Pane pane = (await session.GetPanesAsync(token))[0];
    await pane.SendTextAsync(
        "printf '\\nlibtmux capture ready\\n'", cancellationToken: token);

    var elapsed = Stopwatch.StartNew();
    bool captured = false;
    while (elapsed.Elapsed < TimeSpan.FromSeconds(5))
    {
        var lines = await pane.CaptureAsync(cancellationToken: token);
        if (lines.Contains("libtmux capture ready"))
        {
            Console.WriteLine("libtmux capture ready");
            captured = true;
            break;
        }
        await Task.Delay(25, token);
    }
    if (!captured)
        throw new TimeoutException("Output did not arrive within five seconds");
}
finally
{
    Directory.Delete(directory, recursive: true);
}
```

<a id="wait-for-text-instead-of-guessing-a-delay"></a>

## Wait for output or completion

The program above checks the captured screen for up to five seconds. The short
pause between checks limits polling; the observed output determines when the loop
finishes. A tmux capture is a view of the screen and scrollback, so it can miss
output that has already scrolled away. Use a stream or a completion signal for
long-running commands when that distinction matters.

[Capturing output](/guides/capturing-output/) covers capture options, while
[Sending keys](/guides/sending-keys/#the-race-you-cant-see-from-the-call-site)
explains why sending and waiting are separate operations.

## Setup and run

Use an empty directory. The commands pin the library
revision used to verify the program.

Save the program as `Program.cs` and this file as `Capture.csproj`. Use the
.NET 10 SDK. The project disables implicit imports, so every required import
appears in the program.

```xml title="Capture.csproj"
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
    <ProjectReference Include="libtmux-source/src/LibTmux/LibTmux.csproj" />
  </ItemGroup>
</Project>
```

```console
$ git clone https://github.com/libtmux/libtmux-dotnet libtmux-source &&
  git -C libtmux-source checkout 320dc64f4b8b7815842471327a5e6b84a1499bf8 &&
  dotnet build Capture.csproj --maxcpucount:1 &&
  dotnet run --project Capture.csproj --no-build
```

<a id="source-inclusion"></a>

## Where this comes from

This complete program was run against the library revision pinned above.
The displayed code is checked against the bytes from that run.
