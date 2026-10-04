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

In a new directory, fetch the source revision used by this documentation:

```console
$ mkdir dotnet-workspace-example
$ cd dotnet-workspace-example
$ git init -q libtmux-source
$ git -C libtmux-source remote add origin \
    https://github.com/libtmux/libtmux-dotnet.git
$ git -C libtmux-source fetch --depth=1 origin \
    320dc64f4b8b7815842471327a5e6b84a1499bf8
$ git -C libtmux-source checkout --detach FETCH_HEAD
```

Save the following project file. The project reference builds the workspace
package and its core dependency from that checkout.

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
    <ProjectReference Include="libtmux-source/src/LibTmux/LibTmux.csproj" />
    <ProjectReference
        Include="libtmux-source/src/LibTmux.Workspace/LibTmux.Workspace.csproj"
    />
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
            throw new PlatformNotSupportedException("Requires POSIX tmux.");

        TimeSpan limit = TimeSpan.FromSeconds(30);
        using var deadline = new CancellationTokenSource(limit);
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
        int windows = result.Windows.Count;
        Console.WriteLine($"{result.Session.Name}: {windows} windows");
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

[Workspace API source](https://github.com/libtmux/libtmux-dotnet/tree/320dc64f4b8b7815842471327a5e6b84a1499bf8/src/LibTmux.Workspace)
