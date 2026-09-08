---
title: ".NET workspace examples"
description: "Build and inspect the session returned by LibTmux.Workspace."
port: dotnet
product: workspace
sidebar:
  label: Examples
  order: 3
tableOfContents: true
---

The workspace package README demonstrates parsing a two-window description
and inspecting its typed result. Its documentation examples are compiled and
run by the port's README example tests.

## Parse and build

Within an async method that already has a LibTmux `Server` and cancellation
token `ct`, import `LibTmux.Workspace` and use:

```csharp
WorkspaceFile workspace = WorkspaceFile.Parse("""
    session_name: api
    start_directory: /tmp
    windows:
      - window_name: editor
        panes:
          - shell_command: echo editing
      - window_name: server
        panes:
          - shell_command: echo serving
    """);

WorkspaceResult result = await new WorkspaceBuilder(server)
    .BuildAsync(workspace, ct);
Console.WriteLine($"{result.Session.Name}: {result.Windows.Count} windows");
```

The workspace starts in the configured directory and returns two windows.
The [guide](../guides/) supplies the missing application setup and a server
scope that performs cleanup. Use the result's `Unsupported` entries to report
layouts rejected by tmux.

## Verification

The port's integration project contains workspace parsing, builder, readiness,
and partial-result checks. From a prepared source checkout, run them with:

```console
$ dotnet test tests/LibTmux.IntegrationTests \
    --framework net10.0 \
    --filter FullyQualifiedName~Workspace
```

A separate package-consumer program parses workspace data through the packed
package to check that the optional dependency is usable outside the source
project. Rendering this page is not an execution of either test path.

[README example](https://github.com/libtmux/libtmux-dotnet/blob/6656a563ec9e07ab52e0c3ac96f7704fc94cc0c0/src/LibTmux.Workspace/README.md); [Package consumer](https://github.com/libtmux/libtmux-dotnet/blob/6656a563ec9e07ab52e0c3ac96f7704fc94cc0c0/tests/LibTmux.PackageConsumer/Program.cs).
