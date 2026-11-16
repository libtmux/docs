---
port: csharp
route: guides/attaching-to-tmux
title: Attaching to tmux
description: Connect to an existing tmux server and find a session with C#.
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

Save the complete program as `Program.cs`. When `LIBTMUX_SOCKET_PATH` names a
socket, `FindWorkAsync` connects a `Server` to it, finds `work`, prints the name
and leaves that server running.

Without the variable, the program starts a private tmux server in a new
temporary directory and creates a detached `work` session in it. It then
connects a second `Server` to the socket by path and runs the same lookup. The
`finally` block stops only the private server and removes its directory. If
tmux cannot be stopped, the program keeps the directory and prints its location.

```csharp title="Program.cs"
using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using LibTmux;

if (OperatingSystem.IsWindows())
    throw new PlatformNotSupportedException("Use Linux or macOS");

static async Task FindWorkAsync(string socket, CancellationToken token)
{
    Server server = await Server.ConnectAsync(
        new ServerConnectionOptions { SocketPath = socket }, token);
    if (!await server.HasSessionAsync("work", cancellationToken: token))
        throw new InvalidOperationException("The work session does not exist");
    Console.WriteLine("work");
}

using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
CancellationToken token = timeout.Token;
string? existing = Environment.GetEnvironmentVariable("LIBTMUX_SOCKET_PATH");
if (!string.IsNullOrEmpty(existing))
{
    await FindWorkAsync(existing, token);
    return;
}

DirectoryInfo directory = Directory.CreateTempSubdirectory("libtmux-attach-");
OwnedServerScope? owned = null;
try
{
    string socket = Path.Combine(directory.FullName, "tmux.sock");
    owned = await Server.CreateOwnedAsync(
        new ServerConnectionOptions
        {
            SocketPath = socket,
            ConfigurationFile = "/dev/null",
        }, token);
    await owned.Value.CreateSessionAsync(
        new NewSessionRequest { Name = "work", Command = "/bin/cat" }, token);
    await FindWorkAsync(socket, token);
}
finally
{
    if (owned is not null)
    {
        try { await owned.DisposeAsync(); }
        catch (Exception)
        {
            Console.Error.WriteLine(
                $"Cannot stop tmux; kept {directory.FullName}");
            throw;
        }
    }
    directory.Delete(recursive: true);
}
```

## Setup and run

Use an empty directory on Linux with tmux 3.3a or newer installed. The project
file installs `LibTmux` 0.1.1 from NuGet ([source](https://github.com/libtmux/libtmux-dotnet/tree/8d47af7d89638ad267528ac56897cec67df597f7/src/LibTmux)).

This example was checked with .NET SDK 10.0.403.

Save this file beside the program using the displayed filename.

```xml title="Connect.csproj"
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

Build and run:

```console
$ dotnet build Connect.csproj --maxcpucount:1 &&
  dotnet run --project Connect.csproj --no-build
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
[Capture pane output](/examples/capture-pane-output/). Continue with
[Sending keys](/guides/sending-keys/) once you have a pane handle.
