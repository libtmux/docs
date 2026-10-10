---
title: Run a command through MCP
description: Discover a pane, run a bounded shell command, and check its exit status and captured output.
port: csharp
product: mcp
sidebar:
  group: Examples
  order: 20
---

This program creates a private shell pane and discovers its ID through
[`list_panes`](../../tools/list_panes/). It calls
[`run_shell_command`](../../tools/run_shell_command/), checks the shell exit
status, and verifies that the captured output contains the expected line.

The program owns the tmux server it creates and attempts cleanup after both
successful and failed requests. It does not select a pane from your existing
sessions.

## Run the example

Use the .NET 10 SDK and tmux 3.2a or newer on Linux, macOS, or WSL. The library
and tool use the same [published source revision](https://github.com/libtmux/libtmux-dotnet/tree/ec8b6ab2a4f65e23664f43fba538ba200d4ae8bc).

Create an empty directory:

```console
$ mkdir run-mcp-command
```

```console
$ cd run-mcp-command
```

Install the MCP executable into that directory:

```console
$ dotnet tool install \
    --tool-path .tools \
    --version 0.0.0-alpha.20 \
    LibTmux.Mcp
```

Save the project file:

```xml title="McpExample.csproj"
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="LibTmux" Version="0.0.0-alpha.20" />
    <PackageReference Include="ModelContextProtocol" Version="2.2.0" />
  </ItemGroup>
</Project>
```

### Client program

Save this as `Program.cs`:

```csharp title="Program.cs"
using System.Text.Json;
using LibTmux;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

if (OperatingSystem.IsWindows())
{
    throw new PlatformNotSupportedException(
        "Use Linux, macOS, or WSL with tmux.");
}

using CancellationTokenSource deadline = new(TimeSpan.FromSeconds(30));
CancellationToken token = deadline.Token;
DirectoryInfo directory = Directory.CreateTempSubdirectory("libtmux-mcp-");
string socket = Path.Combine(directory.FullName, "tmux.sock");
Console.Error.WriteLine($"Private socket: {socket}");

OwnedServerScope? owned = null;
McpClient? client = null;
List<Exception> failures = [];
bool stopped = false;

try
{
    ServerConnectionOptions options = new()
    {
        SocketPath = socket,
        ConfigurationFile = "/dev/null",
    };
    owned = await Server.CreateOwnedAsync(options, token);
    await owned.Value.CreateSessionAsync(
        new NewSessionRequest { Name = "docs-demo", Command = "/bin/sh" },
        token);

    Dictionary<string, string?> environment =
        StdioClientTransportOptions.GetDefaultEnvironmentVariables();
    string? dotnetRoot = Environment.GetEnvironmentVariable("DOTNET_ROOT");
    environment["DOTNET_ROOT"] = dotnetRoot;
    environment["LIBTMUX_SOCKET_PATH"] = socket;
    environment["LIBTMUX_TOOLSETS"] = "inspect,execute";
    environment["LIBTMUX_MCP_WAIT_MAX_SECONDS"] = "5";

    StdioClientTransport transport = new(new StdioClientTransportOptions
    {
        Name = "tmux",
        Command = Path.GetFullPath(".tools/libtmux-mcp"),
        InheritEnvironmentVariables = false,
        EnvironmentVariables = environment,
        ShutdownTimeout = TimeSpan.FromSeconds(5),
    });
    client = await McpClient.CreateAsync(transport, cancellationToken: token);

    var tools = await client.ListToolsAsync(cancellationToken: token);
    if (!tools.Any(tool => tool.Name == "run_shell_command"))
    {
        throw new InvalidOperationException(
            "Command execution is not offered.");
    }

    JsonElement panes = ReadResult(await client.CallToolAsync(
        "list_panes", cancellationToken: token));
    string pane = panes.EnumerateArray().Single()
        .GetProperty("paneId").GetString()
        ?? throw new InvalidOperationException("The pane has no ID.");

    JsonElement result = ReadResult(await client.CallToolAsync(
        "run_shell_command",
        new Dictionary<string, object?>
        {
            ["paneId"] = pane,
            ["command"] = "printf 'MCP command ready\\n'",
            ["timeoutSeconds"] = 5,
        },
        cancellationToken: token));
    if (result.GetProperty("timedOut").GetBoolean()
        || result.GetProperty("paneExited").GetBoolean()
        || !result.GetProperty("started").GetBoolean())
    {
        throw new InvalidOperationException(
            $"Command did not finish: {result}");
    }
    int status = result.GetProperty("exitStatus").GetInt32();
    if (status != 0)
    {
        throw new InvalidOperationException($"Shell exit status: {status}");
    }

    JsonElement output = result.GetProperty("output");
    bool found = output.GetProperty("lines").EnumerateArray()
        .Any(line => line.GetString() == "MCP command ready");
    if (!found || output.GetProperty("truncated").GetBoolean()
        || result.GetProperty("linesMissed").GetBoolean()
        || result.GetProperty("anchorLost").GetBoolean())
    {
        throw new InvalidOperationException(
            $"Incomplete command output: {result}");
    }
    Console.WriteLine($"Command exit status: {status}");
    Console.WriteLine("Captured marker: MCP command ready");
}
catch (Exception error)
{
    failures.Add(error);
}

if (client is not null)
{
    try
    {
        await client.DisposeAsync();
    }
    catch (Exception error)
    {
        failures.Add(new IOException("MCP client cleanup failed.", error));
    }
}

if (owned is not null)
{
    try
    {
        await owned.DisposeAsync();
        stopped = true;
    }
    catch (Exception error)
    {
        failures.Add(new IOException("Owned server cleanup failed.", error));
    }
}

if (stopped)
{
    try
    {
        directory.Delete(recursive: true);
    }
    catch (Exception error)
    {
        failures.Add(
            new IOException("Temporary directory cleanup failed.", error));
    }
}
else
{
    Console.Error.WriteLine($"Retained directory: {directory.FullName}");
}

if (failures.Count != 0)
{
    throw new AggregateException(failures);
}
Console.WriteLine("Owned server stopped.");

static JsonElement ReadResult(CallToolResult result)
{
    if (result.IsError == true
        || result.StructuredContent is not JsonElement data)
    {
        throw new InvalidOperationException(JsonSerializer.Serialize(result));
    }
    return data;
}
```

Run the program from the directory containing these files and `.tools`:

```console
$ dotnet run --project McpExample.csproj --no-launch-profile
```

It prints the private socket path to stderr. Its stdout is:

```text
Command exit status: 0
Captured marker: MCP command ready
Owned server stopped.
```

## Completion and output

The client offers `inspect` and `execute`. It discovers the actual pane ID
instead of assuming that the first pane has a particular number. The command
wait is limited to five seconds; startup and MCP requests share a separate
30-second deadline.

Check the tool result before reading the shell result. The
[`ReadResult`](#client-program) helper in this example rejects `isError` and
missing structured content. The program then
checks completion, shell status, and capture completeness separately.
`linesMissed`, `anchorLost`, or a truncated capture means output may be
missing even if the command exited successfully.

The command runs in a subshell. A `cd` or `export` inside one call does not
persist into another call. Combine dependent shell operations in one command
when they need to share a directory or environment.

## Failures and cleanup

A timeout with `started: false` means the command wrapper was not seen to
begin; inspect whether the pane is at an empty, ready shell prompt. A timeout
after startup can leave the command running. `paneExited` instead reports
that the pane's program ended before returning a shell status.

For this private example, cleanup stops the owned server and any remaining
pane command. In an application that borrows an existing pane, cancelling the
wait does not stop the command. Inspect that pane before deciding to retry or
send more input.

MCP shutdown and owned-server shutdown are attempted independently, and the
program reports cleanup failures alongside request failures. It deletes its
temporary directory only after owned-server cleanup succeeds. The
[session inspection example](../inspect-sessions/#shutdown) explains that
ownership pattern, and [Waits and captured output](../../topics/waits-and-output/)
covers observation, cancellation, and response budgets.
