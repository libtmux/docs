---
title: List sessions through MCP
description: Start an inspection client, verify its tool selection, and read structured session metadata.
port: csharp
product: mcp
sidebar:
  group: Examples
  order: 10
---

This program starts a private tmux server, creates a session, and launches
`libtmux-mcp` as a child process. It checks the offered tools and reads
[`list_sessions`](../../tools/list_sessions/) through the official C# MCP
client. The program stops its owned server when the request succeeds or fails.

## Run the example

Use the .NET 10 SDK and tmux 3.2a or newer on Linux, macOS, or WSL. The project
pins the library and tool to the same published alpha release. The package
source is [libtmux-dotnet at the documented release](https://github.com/libtmux/libtmux-dotnet/tree/ec8b6ab2a4f65e23664f43fba538ba200d4ae8bc).

Create an empty directory:

```console
$ mkdir inspect-mcp-sessions
```

```console
$ cd inspect-mcp-sessions
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
    throw new PlatformNotSupportedException("Use Linux, macOS, or WSL with tmux.");
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
        new NewSessionRequest { Name = "docs-demo", Command = "/bin/cat" },
        token);

    Dictionary<string, string?> environment =
        StdioClientTransportOptions.GetDefaultEnvironmentVariables();
    environment["DOTNET_ROOT"] = Environment.GetEnvironmentVariable("DOTNET_ROOT");
    environment["LIBTMUX_SOCKET_PATH"] = socket;
    environment["LIBTMUX_TOOLSETS"] = "inspect";

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
    if (!tools.Any(tool => tool.Name == "list_sessions")
        || tools.Any(tool => tool.Name == "run_shell_command"))
    {
        throw new InvalidOperationException("Unexpected tool selection.");
    }

    ReadResourceResult resource = await client.ReadResourceAsync(
        "tmux://capabilities", cancellationToken: token);
    TextResourceContents text = (TextResourceContents)resource.Contents.Single();
    using JsonDocument capabilities = JsonDocument.Parse(text.Text);
    string?[] selection = capabilities.RootElement.GetProperty("toolsets")
        .EnumerateArray().Select(value => value.GetString()).ToArray();
    if (!selection.SequenceEqual(new[] { "inspect" }))
    {
        throw new InvalidOperationException("Unexpected capability report.");
    }
    Console.WriteLine("Tool selection: inspect");

    CallToolResult result = await client.CallToolAsync(
        "list_sessions", cancellationToken: token);
    if (result.IsError == true || result.StructuredContent is not JsonElement data)
    {
        throw new InvalidOperationException(JsonSerializer.Serialize(result));
    }
    JsonElement session = data.EnumerateArray().Single();
    string? name = session.GetProperty("name").GetString();
    int windows = session.GetProperty("windowCount").GetInt32();
    if (name != "docs-demo" || windows != 1)
    {
        throw new InvalidOperationException("Unexpected session metadata.");
    }
    Console.WriteLine($"Session: {name} ({windows} window)");
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
        failures.Add(new IOException("Temporary directory cleanup failed.", error));
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
```

Run it from the directory containing both files and `.tools`:

```console
$ dotnet run --project McpExample.csproj --no-launch-profile
```

The program prints its private socket path to stderr. Its stdout is:

```text
Tool selection: inspect
Session: docs-demo (1 window)
Owned server stopped.
```

## Read the result

The client connects and discovers tools before making a request. It verifies
that `list_sessions` is offered and
`run_shell_command` is absent, then checks the frozen selection reported by
`tmux://capabilities`.

A successful protocol exchange can still contain a tool error. Check
[`IsError`](https://csharp.sdk.modelcontextprotocol.io/v2/api/ModelContextProtocol.Protocol.CallToolResult.html#ModelContextProtocol_Protocol_CallToolResult_IsError)
before reading
[`StructuredContent`](https://csharp.sdk.modelcontextprotocol.io/v2/api/ModelContextProtocol.Protocol.CallToolResult.html#ModelContextProtocol_Protocol_CallToolResult_StructuredContent).
Here, structured content is an array of session records. The example checks
the created session's name and window count. It reads metadata without
capturing terminal output or sending input through MCP.

The result shape follows the negotiated protocol. For versions before
2026-07-28, the SDK server [wraps the array in a `result` property](https://github.com/modelcontextprotocol/csharp-sdk/blob/6fa3825973949a9c4f0cd8af344e15a8db09dc35/src/ModelContextProtocol.Core/Server/AIFunctionMcpServerTool.cs#L528-L535).
Use the tool's advertised output schema when writing a different client.

The client passes the SDK's ordinary launch environment plus its explicit
socket and tool selection. It does not inherit an interactive shell's
`TMUX`, `TMUX_PANE`, or other `LIBTMUX_*` settings. `DOTNET_ROOT` is carried
over when the runtime installation needs it.

## Shutdown

Startup and requests share a 30-second deadline. Closing the MCP client gives
its child process five seconds to exit before the SDK terminates it. Closing
the owned server uses a separate cleanup deadline, so an expired request token
does not skip daemon cleanup.

The program attempts both cleanups and reports their failures alongside any
request error. It removes the temporary directory only after owned-server
cleanup succeeds. If ownership was not established or server cleanup fails,
it prints the retained directory for inspection.

The [connection guide](../../guides/) covers connecting to an existing server.
The [tool reference](../../tools/list_sessions/) describes the session fields,
and the [owned-server implementation](https://github.com/libtmux/libtmux-dotnet/blob/ec8b6ab2a4f65e23664f43fba538ba200d4ae8bc/src/LibTmux/Server.Lifecycle.cs)
defines daemon ownership and cleanup.
