---
title: "C# workspace builder examples"
description: "Internal examples for building and inspecting workspaces through the C# API."
port: csharp
product: workspace
aliases: [examples/workspace-from-file]
sidebar:
  group: Internals
  label: Examples
  order: 3
tableOfContents: true
---

Build a two-window workspace, print its size, and remove its private tmux server.
Use a POSIX host with tmux on `PATH` and the .NET 10 SDK.

## Create the project

Create a new directory:

```console
$ mkdir dotnet-workspace-example
$ cd dotnet-workspace-example
```

Save the following project file. It installs the `LibTmux.Workspace` package and
its `LibTmux` dependency, both 0.1.1, from NuGet.

```xml title="WorkspaceExample.csproj"
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
    <PackageReference Include="LibTmux.Workspace" Version="0.1.1" />
  </ItemGroup>
</Project>
```

## Build and inspect

Save this complete program as `Program.cs` beside the project file:

```csharp title="Program.cs"
using System;
using System.Threading;
using System.Threading.Tasks;
using LibTmux;
using LibTmux.Workspace;

internal static class Program
{
    private static async Task Main()
    {
        if (OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("This example requires POSIX tmux.");

        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        WorkspaceFile workspace = WorkspaceFile.Parse("""
            session_name: built
            options:
              default-shell: /bin/sh
            windows:
              - window_name: editor
                panes:
                  - shell_command: echo editing
                  - shell_command: echo watching
              - window_name: server
                panes:
                  - shell_command: echo serving
            """);

        await using var owned = await Server.CreateOwnedAsync(
            new ServerConnectionOptions
            {
                SocketName = $"workspace-{Guid.NewGuid():N}",
                ConfigurationFile = "/dev/null",
            },
            deadline.Token);
        WorkspaceResult result = await new WorkspaceBuilder(owned.Value)
            .BuildAsync(workspace, deadline.Token);
        Console.WriteLine($"{result.Session.Name}: {result.Windows.Count} windows");
        foreach (string unsupported in result.Unsupported)
            Console.WriteLine(unsupported);
    }
}
```

Build and run it from the example directory:

```console
$ dotnet run --project WorkspaceExample.csproj --configuration Release
```

The program prints `built: 2 windows`. The owned scope removes the server on
success or failure. Its unique socket and empty tmux configuration keep the
example separate from an existing server. The deadline bounds construction;
owned-scope cleanup uses its own lifetime.

`BuildAsync` returns after creating the workspace and sending its commands.
That does not establish completion of programs running in the panes. A build
failure can leave partial results; the owned server scope removes them here.

<a id="where-this-comes-from"></a>
<a id="source-inclusion"></a>

[Workspace API source](https://github.com/libtmux/libtmux-dotnet/tree/8d47af7d89638ad267528ac56897cec67df597f7/src/LibTmux.Workspace)
