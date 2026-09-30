---
title: Swift MCP examples
description: Call an embedded Swift MCP tool against a private tmux server.
port: swift
product: mcp
sidebar:
  label: Examples
  order: 3
tableOfContents: true
---

Embed the Swift MCP tool surface, expose only `list_sessions`, and check its
structured result against a private tmux session. The program calls the same
tool implementation used by the stdio server. For an external MCP client,
use the [connection guide](../guides/).

## Prepare the project

Use Swift 6.2.4, Git, and tmux 3.2a or newer on Linux. Create an empty project
and the executable's source directory:

```console
$ mkdir swift-mcp-example && cd swift-mcp-example && \
  mkdir -p Sources/MCPExample
```

Fetch the library revision used by this example:

```console
$ git init libtmux-source && \
  git -C libtmux-source remote add origin https://github.com/libtmux/libtmux-swift.git && \
  git -C libtmux-source fetch --depth=1 origin 254f8b2be7eb60cacc3ffcb3ea8e456784f582df && \
  git -C libtmux-source checkout --detach FETCH_HEAD
```

Save the following package manifest at the project root:

```swift title="Package.swift"
// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "MCPExample",
    platforms: [.macOS(.v13)],
    dependencies: [.package(path: "libtmux-source")],
    targets: [
        .executableTarget(
            name: "MCPExample",
            dependencies: [
                .product(name: "LibTmux", package: "libtmux-source"),
                .product(name: "LibTmuxMCP", package: "libtmux-source"),
            ]
        ),
    ]
)
```

<a id="list-sessions"></a>
<a id="internals"></a>
<a id="embed-the-tool-surface"></a>

## Run the complete program

Save this file in the source directory created above. Its private socket is
checked during cleanup even when startup fails. Cleanup failures preserve the
original error and report the retained directory.

```swift title="Sources/MCPExample/MCPExample.swift"
import Foundation
import LibTmux
import LibTmuxMCP

struct ExampleFailure: Error, CustomStringConvertible {
    let description: String
}

func withPrivateTmux(
    _ body: @Sendable (Server) async throws -> Void
) async throws {
    let directory = URL(fileURLWithPath: "/tmp")
        .appendingPathComponent("libtmux-swift-example-\(UUID().uuidString)")
    let server = try Server(
        socketPath: directory.appendingPathComponent("s").path,
        configurationFile: "/dev/null"
    )
    try FileManager.default.createDirectory(
        at: directory, withIntermediateDirectories: false,
        attributes: [.posixPermissions: 0o700]
    )
    var failures: [String] = []
    do { try await body(server) }
    catch { failures.append("Operation: \(error)") }
    do {
        let files = try FileManager.default.contentsOfDirectory(
            atPath: directory.path
        )
        if files.contains("s") { try await server.killServer() }
        try FileManager.default.removeItem(at: directory)
    } catch {
        failures.append("Cleanup at \(directory.path): \(error)")
    }
    if !failures.isEmpty {
        throw ExampleFailure(description: failures.joined(separator: "\n"))
    }
}

@main
struct MCPExample {
    static func main() async throws {
        try await withPrivateTmux { server in
            let started = try await server.run([
                TmuxCommand("set-option", ["-g", "default-shell", "/bin/sh"]),
                TmuxCommand("set-environment", ["-g", "ENV", ""]),
                TmuxCommand("set-environment", ["-g", "BASH_ENV", ""]),
                TmuxCommand("new-session", [
                    "-d", "-s", "mcp-example", "exec /bin/cat",
                ]),
            ])
            guard started.isSuccess else {
                throw ExampleFailure(description: started.errorText)
            }
            let tools = TmuxTools(
                server: server,
                authority: ToolAuthority(
                    toolsets: [], includedTools: ["list_sessions"]
                ),
                caller: nil
            )
            let names = tools.visibleDefinitions.map(\.name)
            guard names == ["list_sessions"] else {
                throw ExampleFailure(description: "Unexpected tool selection")
            }
            let result = try await tools.call(ToolCall(name: "list_sessions"))
            guard let sessions = result.structured["sessions"]?.arrayValue,
                sessions.count == 1,
                sessions[0]["name"]?.stringValue == "mcp-example"
            else {
                throw ExampleFailure(description: "Unexpected session result")
            }
            print("tools: \(names.joined(separator: ", "))")
            print("sessions: mcp-example")
        }
    }
}
```

<a id="run-its-tests"></a>

Build and run the executable:

```console
$ swift run --jobs 2 MCPExample
```

Expected output:

```text
tools: list_sessions
sessions: mcp-example
```

`ToolAuthority` starts with no toolsets and includes only `list_sessions`.
`caller: nil` avoids importing an ambient tmux pane identity. The explicitly
configured server selects the private socket.

A thrown `ToolError` reports a failed invocation. The successful result carries
structured session data; retain the returned session IDs for later operations.
The [tool reference](../tools/list_sessions/) describes the result schema.

[Library source](https://github.com/libtmux/libtmux-swift/tree/254f8b2be7eb60cacc3ffcb3ea8e456784f582df/Sources/LibTmuxMCP).
